package main

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

const ddragonURL = "https://ddragon.leagueoflegends.com"

// ChampInfo holds Data Dragon champion metadata.
type ChampInfo struct {
	ID   string // Data Dragon ID, e.g. "Aatrox"
	Name string // Display name, e.g. "Aatrox"
}

// ChampSelectUpdate is the message sent to the bridge when champ select changes.
type ChampSelectUpdate struct {
	Type         string `json:"type"`
	ChampionID   string `json:"championId,omitempty"`
	ChampionName string `json:"championName,omitempty"`
	ChampionKey  string `json:"championKey,omitempty"`
	SkinNum      int    `json:"skinNum,omitempty"`
	SkinID       string `json:"skinId,omitempty"`
}

// StatusCallback is called whenever the LCU connection status changes.
type StatusCallback func(status string)

// ChampSelectCallback is called with champion-select updates.
type ChampSelectCallback func(update ChampSelectUpdate)

// AccountInfoCallback is called with the current summoner's account info (from LCU).
type AccountInfoCallback func(info AccountInfo)

// AccountInfo holds PUUID and display info for Riot API / match history.
type AccountInfo struct {
	PUUID       string `json:"puuid"`
	DisplayName string `json:"displayName"`
	SummonerID  string `json:"summonerId,omitempty"`
	AccountID   int64  `json:"accountId,omitempty"`
	PlatformID  string `json:"platformId,omitempty"` // e.g. NA1, EUW1 (maps to regional routing)
}

// LCUConnector detects the running League client, authenticates via the local
// API, subscribes to champion-select WebSocket events, and emits updates.
type LCUConnector struct {
	port  string
	token string

	championMap map[string]ChampInfo // numeric key → ChampInfo
	lastUpdate  string               // dedup key

	onStatus       StatusCallback
	onChampSelect  ChampSelectCallback
	onAccountInfo  AccountInfoCallback

	ws        *websocket.Conn
	stopCh    chan struct{}
	stopped   bool
	stoppedMu sync.Mutex
}

// NewLCUConnector creates a new connector with the given callbacks.
// onAccountInfo may be nil (account fetch skipped).
func NewLCUConnector(onStatus StatusCallback, onChampSelect ChampSelectCallback, onAccountInfo AccountInfoCallback) *LCUConnector {
	return &LCUConnector{
		championMap:    make(map[string]ChampInfo),
		onStatus:       onStatus,
		onChampSelect:  onChampSelect,
		onAccountInfo:  onAccountInfo,
		stopCh:         make(chan struct{}),
	}
}

// Start fetches the champion map and begins polling for the League client.
func (l *LCUConnector) Start() {
	l.fetchChampionMap()
	l.pollForClient()
}

// Stop shuts down polling and closes any active WebSocket connection.
func (l *LCUConnector) Stop() {
	l.stoppedMu.Lock()
	if l.stopped {
		l.stoppedMu.Unlock()
		return
	}
	l.stopped = true
	close(l.stopCh)
	l.stoppedMu.Unlock()

	if l.ws != nil {
		l.ws.Close()
	}
}

func (l *LCUConnector) isStopped() bool {
	l.stoppedMu.Lock()
	defer l.stoppedMu.Unlock()
	return l.stopped
}

// ── Data Dragon champion list ───────────────────────────────────────────

func (l *LCUConnector) fetchChampionMap() {
	// Get latest version
	raw, err := httpGet(ddragonURL + "/api/versions.json")
	if err != nil {
		log.Printf("[lcu] Failed to fetch versions: %v", err)
		return
	}

	var versions []string
	if err := json.Unmarshal(raw, &versions); err != nil || len(versions) == 0 {
		log.Printf("[lcu] Failed to parse versions: %v", err)
		return
	}
	version := versions[0]

	// Get champion data
	champRaw, err := httpGet(fmt.Sprintf("%s/cdn/%s/data/en_US/champion.json", ddragonURL, version))
	if err != nil {
		log.Printf("[lcu] Failed to fetch champion data: %v", err)
		return
	}

	var champData struct {
		Data map[string]struct {
			Key  string `json:"key"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(champRaw, &champData); err != nil {
		log.Printf("[lcu] Failed to parse champion data: %v", err)
		return
	}

	for id, champ := range champData.Data {
		l.championMap[champ.Key] = ChampInfo{ID: id, Name: champ.Name}
	}
	log.Printf("[lcu] Loaded %d champions from Data Dragon", len(l.championMap))
}

// ── League client detection ─────────────────────────────────────────────

var (
	portRe  = regexp.MustCompile(`--app-port=(\d+)`)
	tokenRe = regexp.MustCompile(`--remoting-auth-token=([^\s"]+)`)
)

func (l *LCUConnector) pollForClient() {
	if l.isStopped() {
		return
	}
	l.onStatus("Waiting for League Client…")

	// Check immediately, then every 5 seconds
	if l.detectClient() {
		return
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-l.stopCh:
			return
		case <-ticker.C:
			if l.detectClient() {
				return
			}
		}
	}
}

func (l *LCUConnector) detectClient() bool {
	if l.isStopped() {
		return false
	}

	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		`Get-CimInstance Win32_Process -Filter "name='LeagueClientUx.exe'" | Select-Object -ExpandProperty CommandLine`)
	cmd.SysProcAttr = hiddenProcAttr()
	out, err := cmd.Output()
	if err != nil || len(out) == 0 {
		return false
	}

	stdout := string(out)
	portMatch := portRe.FindStringSubmatch(stdout)
	tokenMatch := tokenRe.FindStringSubmatch(stdout)

	if portMatch == nil || tokenMatch == nil {
		return false
	}

	l.port = portMatch[1]
	l.token = tokenMatch[1]
	l.connectToLCU()
	return true
}

// ── LCU WebSocket connection ────────────────────────────────────────────

func (l *LCUConnector) connectToLCU() {
	if l.isStopped() {
		return
	}
	l.onStatus("Connecting to League Client…")

	auth := base64.StdEncoding.EncodeToString([]byte("riot:" + l.token))

	dialer := websocket.Dialer{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // LCU uses self-signed cert
	}

	url := fmt.Sprintf("wss://127.0.0.1:%s/", l.port)
	headers := http.Header{"Authorization": {"Basic " + auth}}

	conn, _, err := dialer.Dial(url, headers)
	if err != nil {
		log.Printf("[lcu] WebSocket dial error: %v", err)
		l.onStatus("Connection failed – Retrying…")
		if !l.isStopped() {
			time.Sleep(3 * time.Second)
			go l.pollForClient()
		}
		return
	}

	l.ws = conn
	log.Println("[lcu] Connected to League Client WebSocket")
	l.onStatus("Connected – Waiting for Champion Select…")

	// Fetch account info (PUUID, etc.) for match history / dev tools
	if l.onAccountInfo != nil {
		go l.fetchAndEmitAccountInfo(auth)
	}

	// Subscribe to champion-select session events (WAMP opcode 5 = subscribe)
	subscribe := `[5, "OnJsonApiEvent_lol-champ-select_v1_session"]`
	if err := conn.WriteMessage(websocket.TextMessage, []byte(subscribe)); err != nil {
		log.Printf("[lcu] Subscribe error: %v", err)
	}

	// Read loop
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[lcu] WebSocket closed: %v", err)
			l.ws = nil
			l.lastUpdate = ""
			if !l.isStopped() {
				l.onStatus("Disconnected – Reconnecting…")
				time.Sleep(3 * time.Second)
				go l.pollForClient()
			}
			return
		}

		var msg []json.RawMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		// WAMP opcode 8 = event
		if len(msg) >= 3 {
			var opcode int
			if err := json.Unmarshal(msg[0], &opcode); err == nil && opcode == 8 {
				l.handleEvent(msg[2])
			}
		}
	}
}

// ── Event handling ──────────────────────────────────────────────────────

type lcuEvent struct {
	EventType string          `json:"eventType"`
	URI       string          `json:"uri"`
	Data      json.RawMessage `json:"data"`
}

type champSelectSession struct {
	LocalPlayerCellId int             `json:"localPlayerCellId"`
	MyTeam            []teamMember    `json:"myTeam"`
	Actions           [][]actionEntry `json:"actions"`
}

type teamMember struct {
	CellId            int `json:"cellId"`
	ChampionId        int `json:"championId"`
	SelectedSkinId    int `json:"selectedSkinId"`
	ChampionPickIntent int `json:"championPickIntent"`
}

type actionEntry struct {
	ActorCellId int    `json:"actorCellId"`
	Type        string `json:"type"`
	ChampionId  int    `json:"championId"`
}

func (l *LCUConnector) handleEvent(raw json.RawMessage) {
	var event lcuEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return
	}

	if event.URI != "/lol-champ-select/v1/session" {
		return
	}

	if event.EventType == "Delete" {
		l.lastUpdate = ""
		l.onStatus("Connected – Waiting for Champion Select…")
		l.onChampSelect(ChampSelectUpdate{Type: "champSelectEnd"})
		return
	}

	if event.EventType == "Update" || event.EventType == "Create" {
		l.onStatus("In Champion Select")
		l.processSession(event.Data)
	}
}

func (l *LCUConnector) processSession(raw json.RawMessage) {
	var session champSelectSession
	if err := json.Unmarshal(raw, &session); err != nil {
		return
	}
	if len(session.MyTeam) == 0 {
		return
	}

	// Find local player
	var localPlayer *teamMember
	for i := range session.MyTeam {
		if session.MyTeam[i].CellId == session.LocalPlayerCellId {
			localPlayer = &session.MyTeam[i]
			break
		}
	}
	if localPlayer == nil {
		return
	}

	championKey := localPlayer.ChampionId
	selectedSkinId := localPlayer.SelectedSkinId

	// If champion not yet locked in, check the actions array for what's being hovered
	if championKey == 0 {
		for _, group := range session.Actions {
			for _, action := range group {
				if action.ActorCellId == session.LocalPlayerCellId &&
					action.Type == "pick" &&
					action.ChampionId > 0 {
					championKey = action.ChampionId
					selectedSkinId = championKey * 1000 // base skin while hovering
					break
				}
			}
			if championKey > 0 {
				break
			}
		}
	}

	// Fall back to pick intent
	if championKey == 0 {
		championKey = localPlayer.ChampionPickIntent
		if championKey > 0 {
			selectedSkinId = championKey * 1000
		}
	}

	if championKey == 0 {
		return
	}

	champInfo, ok := l.championMap[strconv.Itoa(championKey)]
	if !ok {
		return
	}

	skinNum := 0
	if selectedSkinId > 0 {
		skinNum = selectedSkinId % 1000
	}

	// De-duplicate: don't re-emit if nothing changed
	key := fmt.Sprintf("%s:%d", champInfo.ID, skinNum)
	if key == l.lastUpdate {
		return
	}
	l.lastUpdate = key

	log.Printf("[lcu] Champion select: %s skin #%d", champInfo.Name, skinNum)

	skinID := strconv.Itoa(selectedSkinId)
	if selectedSkinId == 0 {
		skinID = strconv.Itoa(championKey * 1000)
	}

	l.onChampSelect(ChampSelectUpdate{
		Type:         "champSelectUpdate",
		ChampionID:   champInfo.ID,
		ChampionName: champInfo.Name,
		ChampionKey:  strconv.Itoa(championKey),
		SkinNum:      skinNum,
		SkinID:       skinID,
	})
}

// ── Account info (LCU HTTP API) ────────────────────────────────────────

func (l *LCUConnector) fetchAndEmitAccountInfo(auth string) {
	if l.onAccountInfo == nil || l.isStopped() {
		return
	}

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 10 * time.Second,
	}

	base := fmt.Sprintf("https://127.0.0.1:%s", l.port)
	req, err := http.NewRequest("GET", base+"/lol-summoner/v1/current-summoner", nil)
	if err != nil {
		log.Printf("[lcu] Account request error: %v", err)
		return
	}
	req.Header.Set("Authorization", "Basic "+auth)

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[lcu] Account fetch error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[lcu] Account fetch HTTP %d", resp.StatusCode)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[lcu] Account read error: %v", err)
		return
	}

	var summoner struct {
		PUUID       string `json:"puuid"`
		DisplayName string `json:"displayName"`
		SummonerID  int64  `json:"summonerId"`
		AccountID   int64  `json:"accountId"`
	}
	if err := json.Unmarshal(body, &summoner); err != nil {
		log.Printf("[lcu] Account parse error: %v", err)
		return
	}

	if summoner.PUUID == "" {
		log.Println("[lcu] No PUUID in current-summoner response")
		return
	}

	// Fetch platformId from LoginSession (for regional routing)
	platformID := ""
	req2, _ := http.NewRequest("GET", base+"/lol-platform-config/v1/namespaces/LoginSession", nil)
	req2.Header.Set("Authorization", "Basic "+auth)
	if resp2, err := client.Do(req2); err == nil && resp2.StatusCode == http.StatusOK {
		var login struct {
			PlatformID string `json:"platformId"`
		}
		if b, _ := io.ReadAll(resp2.Body); json.Unmarshal(b, &login) == nil && login.PlatformID != "" {
			platformID = login.PlatformID
		}
		resp2.Body.Close()
	}

	info := AccountInfo{
		PUUID:       summoner.PUUID,
		DisplayName: summoner.DisplayName,
		SummonerID:  strconv.FormatInt(summoner.SummonerID, 10),
		AccountID:   summoner.AccountID,
		PlatformID:  platformID,
	}
	log.Printf("[lcu] Account: %s (platform: %s)", info.DisplayName, info.PlatformID)
	l.onAccountInfo(info)
}

// ── Helpers ─────────────────────────────────────────────────────────────

func httpGet(url string) ([]byte, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	return io.ReadAll(resp.Body)
}

// hiddenProcAttr returns a SysProcAttr that hides the console window on Windows.
func hiddenProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{HideWindow: true}
}
