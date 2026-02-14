package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	liveClientURL = "https://127.0.0.1:2999"
	pollInterval  = 3 * time.Second
)

// ── Messages sent to the website via the bridge ─────────────────────────

// LiveGameUpdate is broadcast to the website with full scoreboard data.
type LiveGameUpdate struct {
	Type         string           `json:"type"`
	GameTime     float64          `json:"gameTime"`
	GameMode     string           `json:"gameMode"`
	GameResult   string           `json:"gameResult,omitempty"` // "Win" or "Lose" (from active player perspective)
	Active       ActivePlayerInfo `json:"activePlayer"`
	Players      []PlayerInfo     `json:"players"`
	PartyMembers []string         `json:"partyMembers,omitempty"`
	KillFeed     []KillEvent      `json:"killFeed,omitempty"`
	LiveEvents   []LiveGameEvent  `json:"liveEvents,omitempty"`
}

// KillEvent represents a champion kill for the kill feed.
type KillEvent struct {
	EventTime   float64  `json:"eventTime"`
	KillerName  string   `json:"killerName"`  // champion display name
	VictimName  string   `json:"victimName"`  // champion display name
	Assisters   []string `json:"assisters"`   // champion display names
	KillerChamp string   `json:"killerChamp"` // champion id name (for icon)
	VictimChamp string   `json:"victimChamp"` // champion id name (for icon)
}

// LiveGameEvent carries objective and timeline signals from the Riot live API.
type LiveGameEvent struct {
	EventName    string   `json:"eventName"`
	EventTime    float64  `json:"eventTime"`
	KillerName   string   `json:"killerName,omitempty"`
	VictimName   string   `json:"victimName,omitempty"`
	Assisters    []string `json:"assisters,omitempty"`
	TurretKilled string   `json:"turretKilled,omitempty"`
	InhibKilled  string   `json:"inhibKilled,omitempty"`
	MonsterType  string   `json:"monsterType,omitempty"`
	DragonType   string   `json:"dragonType,omitempty"`
	Stolen       bool     `json:"stolen,omitempty"`
}

// ActivePlayerInfo holds detailed data for the local player (gold, stats).
type ActivePlayerInfo struct {
	SummonerName string        `json:"summonerName"`
	Level        int           `json:"level"`
	CurrentGold  float64       `json:"currentGold"`
	Stats        LiveGameStats `json:"stats"`
}

// PlayerInfo holds per-player data visible on the scoreboard.
type PlayerInfo struct {
	SummonerName   string         `json:"summonerName"`
	ChampionName   string         `json:"championName"`
	Team           string         `json:"team"`     // "ORDER" (blue) or "CHAOS" (red)
	Position       string         `json:"position"` // "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY", or ""
	Level          int            `json:"level"`
	Kills          int            `json:"kills"`
	Deaths         int            `json:"deaths"`
	Assists        int            `json:"assists"`
	CreepScore     int            `json:"creepScore"`
	WardScore      float64        `json:"wardScore"`
	Items          []LiveGameItem `json:"items"`
	SkinID         int            `json:"skinID"`
	IsActivePlayer bool           `json:"isActivePlayer"`
	IsDead         bool           `json:"isDead"`
	RespawnTimer   float64        `json:"respawnTimer"`
}

// LiveGameItem represents a single item slot.
type LiveGameItem struct {
	ItemID      int    `json:"itemID"`
	DisplayName string `json:"displayName"`
	Count       int    `json:"count"`
	Slot        int    `json:"slot"`
	Price       int    `json:"price"`
}

// LiveGameStats holds the active player's current stats (base + items + runes + levels).
type LiveGameStats struct {
	AttackDamage      float64 `json:"attackDamage"`
	AbilityPower      float64 `json:"abilityPower"`
	Armor             float64 `json:"armor"`
	MagicResist       float64 `json:"magicResist"`
	AttackSpeed       float64 `json:"attackSpeed"`
	CritChance        float64 `json:"critChance"`
	CritDamage        float64 `json:"critDamage"`
	MoveSpeed         float64 `json:"moveSpeed"`
	MaxHealth         float64 `json:"maxHealth"`
	CurrentHealth     float64 `json:"currentHealth"`
	ResourceMax       float64 `json:"resourceMax"`
	ResourceValue     float64 `json:"resourceValue"`
	ResourceType      string  `json:"resourceType"`
	AbilityHaste      float64 `json:"abilityHaste"`
	LifeSteal         float64 `json:"lifeSteal"`
	Omnivamp          float64 `json:"omnivamp"`
	PhysicalLethality float64 `json:"physicalLethality"`
	MagicLethality    float64 `json:"magicLethality"`
	ArmorPenFlat      float64 `json:"armorPenetrationFlat"`
	ArmorPenPercent   float64 `json:"armorPenetrationPercent"`
	MagicPenFlat      float64 `json:"magicPenetrationFlat"`
	MagicPenPercent   float64 `json:"magicPenetrationPercent"`
	Tenacity          float64 `json:"tenacity"`
	HealShieldPower   float64 `json:"healShieldPower"`
	AttackRange       float64 `json:"attackRange"`
	HealthRegenRate   float64 `json:"healthRegenRate"`
	ResourceRegenRate float64 `json:"resourceRegenRate"`
}

// ── Callbacks ───────────────────────────────────────────────────────────

type LiveGameUpdateCallback func(update LiveGameUpdate)
type LiveGameEndCallback func(result string) // result: "Win", "Lose", or "" (unknown)

// ── LiveGameTracker ─────────────────────────────────────────────────────

// LiveGameTracker polls the Riot Live Client Data API during an active game
// and emits full scoreboard updates for all players.
type LiveGameTracker struct {
	onUpdate LiveGameUpdateCallback
	onEnd    LiveGameEndCallback
	onStatus StatusCallback

	client *http.Client

	stopCh    chan struct{}
	stopped   bool
	stoppedMu sync.Mutex

	wasInGame  bool
	lastHash   string
	gameResult string // captured from GameEnd event
}

// NewLiveGameTracker creates a tracker with the given callbacks.
func NewLiveGameTracker(onStatus StatusCallback, onUpdate LiveGameUpdateCallback, onEnd LiveGameEndCallback) *LiveGameTracker {
	return &LiveGameTracker{
		onUpdate: onUpdate,
		onEnd:    onEnd,
		onStatus: onStatus,
		client: &http.Client{
			Timeout: 2 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
		stopCh: make(chan struct{}),
	}
}

// Start begins polling in a background goroutine.
func (t *LiveGameTracker) Start() {
	go t.pollLoop()
}

// Stop terminates the polling loop.
func (t *LiveGameTracker) Stop() {
	t.stoppedMu.Lock()
	defer t.stoppedMu.Unlock()
	if !t.stopped {
		t.stopped = true
		close(t.stopCh)
	}
}

func (t *LiveGameTracker) isStopped() bool {
	t.stoppedMu.Lock()
	defer t.stoppedMu.Unlock()
	return t.stopped
}

func (t *LiveGameTracker) pollLoop() {
	t.poll()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-t.stopCh:
			return
		case <-ticker.C:
			t.poll()
		}
	}
}

func (t *LiveGameTracker) poll() {
	if t.isStopped() {
		return
	}

	data, err := t.fetchAllGameData()
	if err != nil {
		if t.wasInGame {
			result := t.gameResult
			t.wasInGame = false
			t.lastHash = ""
			t.gameResult = ""
			log.Printf("[livegame] Game ended (result: %q)", result)
			t.onStatus("Connected – Waiting for Champion Select…")
			t.onEnd(result)
		}
		return
	}

	// Check events for GameEnd result (appears in the last moments before the API goes away)
	for _, ev := range data.Events.Events {
		if ev.EventName == "GameEnd" && ev.Result != "" {
			t.gameResult = ev.Result
			log.Printf("[livegame] GameEnd event detected: %s", ev.Result)
		}
	}

	if !t.wasInGame {
		t.wasInGame = true
		t.gameResult = ""
		log.Println("[livegame] Live game detected")
		t.onStatus("In Game – Tracking scoreboard")
	}

	update := t.buildUpdate(data)
	if update == nil {
		return
	}

	// Attach game result if we have it
	update.GameResult = t.gameResult

	hash := t.computeHash(update)
	if hash == t.lastHash {
		return
	}
	t.lastHash = hash

	log.Printf("[livegame] Scoreboard update: %d players, %.0fs",
		len(update.Players), update.GameTime)

	t.onUpdate(*update)
}

func (t *LiveGameTracker) computeHash(u *LiveGameUpdate) string {
	h := fmt.Sprintf("%.0f:%d:%.0f:k%d:e%d",
		u.GameTime,
		u.Active.Level,
		u.Active.CurrentGold,
		len(u.KillFeed),
		len(u.LiveEvents),
	)
	for _, p := range u.Players {
		h += fmt.Sprintf("|%s:%d:%d:%d:%d:%d:%d",
			p.ChampionName, p.Level, p.Kills, p.Deaths, p.Assists, p.CreepScore, p.SkinID)
		for _, item := range p.Items {
			h += fmt.Sprintf("-%d", item.ItemID)
		}
	}
	return h
}

// ── Live Client Data API types ──────────────────────────────────────────

type allGameData struct {
	ActivePlayer activePlayerData `json:"activePlayer"`
	AllPlayers   []playerData     `json:"allPlayers"`
	GameData     gameDataInfo     `json:"gameData"`
	Events       gameEvents       `json:"events"`
}

type gameEvents struct {
	Events []gameEvent `json:"Events"`
}

type gameEvent struct {
	EventName    string   `json:"EventName"`
	EventTime    float64  `json:"EventTime"`
	Result       string   `json:"Result,omitempty"`       // "Win" or "Lose" on GameEnd events
	KillerName   string   `json:"KillerName,omitempty"`   // multiple events
	VictimName   string   `json:"VictimName,omitempty"`   // ChampionKill
	Assisters    []string `json:"Assisters,omitempty"`    // kill/objective events
	TurretKilled string   `json:"TurretKilled,omitempty"` // TurretKilled
	InhibKilled  string   `json:"InhibKilled,omitempty"`  // InhibKilled
	MonsterType  string   `json:"MonsterType,omitempty"`  // DragonKill/BaronKill/HeraldKill/etc
	DragonType   string   `json:"DragonType,omitempty"`   // DragonKill
	Stolen       bool     `json:"Stolen,omitempty"`       // epic objective stolen
}

type activePlayerData struct {
	SummonerName   string          `json:"summonerName"`
	RiotIdGameName string          `json:"riotIdGameName"`
	Level          int             `json:"level"`
	CurrentGold    float64         `json:"currentGold"`
	ChampionStats  json.RawMessage `json:"championStats"`
}

type playerData struct {
	SummonerName    string     `json:"summonerName"`
	RiotIdGameName  string     `json:"riotIdGameName"`
	ChampionName    string     `json:"championName"`
	RawChampionName string     `json:"rawChampionName"`
	Position        string     `json:"position"` // "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"
	Items           []itemData `json:"items"`
	Level           int        `json:"level"`
	Scores          scoresData `json:"scores"`
	SkinID          int        `json:"skinID"`
	Team            string     `json:"team"`
	IsDead          bool       `json:"isDead"`
	RespawnTimer    float64    `json:"respawnTimer"`
}

type itemData struct {
	ItemID      int    `json:"itemID"`
	DisplayName string `json:"displayName"`
	Count       int    `json:"count"`
	Slot        int    `json:"slot"`
	Price       int    `json:"price"`
}

type scoresData struct {
	Kills      int     `json:"kills"`
	Deaths     int     `json:"deaths"`
	Assists    int     `json:"assists"`
	CreepScore int     `json:"creepScore"`
	WardScore  float64 `json:"wardScore"`
}

type gameDataInfo struct {
	GameTime float64 `json:"gameTime"`
	GameMode string  `json:"gameMode"`
}

// ── API fetch ───────────────────────────────────────────────────────────

func (t *LiveGameTracker) fetchAllGameData() (*allGameData, error) {
	resp, err := t.client.Get(liveClientURL + "/liveclientdata/allgamedata")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var data allGameData
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// resolveNonPlayerKiller maps raw internal entity names to a friendly
// display name and a "champion" key (used for icon lookup on the frontend).
// Returns (champKey, displayName).
func resolveNonPlayerKiller(raw string) (string, string) {
	lower := strings.ToLower(raw)
	switch {
	case strings.Contains(lower, "turret"):
		if strings.Contains(lower, "order") {
			return "_turret_blue", "Blue Turret"
		}
		if strings.Contains(lower, "chaos") {
			return "_turret_red", "Red Turret"
		}
		return "_turret", "Turret"
	case strings.Contains(lower, "sru_baron"):
		return "_baron", "Baron Nashor"
	case strings.Contains(lower, "sru_dragon"):
		return "_dragon", "Dragon"
	case strings.Contains(lower, "sru_riftherald"):
		return "_herald", "Rift Herald"
	case strings.Contains(lower, "sru_horde"):
		return "_voidgrub", "Voidgrub"
	case strings.Contains(lower, "minion"):
		if strings.Contains(lower, "order") {
			return "_minion_blue", "Blue Minion"
		}
		if strings.Contains(lower, "chaos") {
			return "_minion_red", "Red Minion"
		}
		return "_minion", "Minion"
	case strings.Contains(lower, "sru_"):
		// Other jungle camps (gromp, krugs, raptors, etc.)
		return "_jungle", "Jungle Camp"
	}
	return "_unknown", raw
}

// ── Build the update message ────────────────────────────────────────────

func (t *LiveGameTracker) isActivePlayer(p *playerData, active *activePlayerData) bool {
	if active.RiotIdGameName != "" && p.RiotIdGameName == active.RiotIdGameName {
		return true
	}
	if active.SummonerName != "" && p.SummonerName == active.SummonerName {
		return true
	}
	return false
}

func (t *LiveGameTracker) buildUpdate(data *allGameData) *LiveGameUpdate {
	// Parse active player stats
	var stats LiveGameStats
	if err := json.Unmarshal(data.ActivePlayer.ChampionStats, &stats); err != nil {
		log.Printf("[livegame] Failed to parse champion stats: %v", err)
	}

	activeName := data.ActivePlayer.RiotIdGameName
	if activeName == "" {
		activeName = data.ActivePlayer.SummonerName
	}

	// Build player list for both teams
	players := make([]PlayerInfo, 0, len(data.AllPlayers))
	for i := range data.AllPlayers {
		p := &data.AllPlayers[i]

		// Convert items (skip empty slots)
		items := make([]LiveGameItem, 0, len(p.Items))
		for _, item := range p.Items {
			if item.ItemID == 0 {
				continue
			}
			items = append(items, LiveGameItem{
				ItemID:      item.ItemID,
				DisplayName: item.DisplayName,
				Count:       item.Count,
				Slot:        item.Slot,
				Price:       item.Price,
			})
		}

		displayName := p.RiotIdGameName
		if displayName == "" {
			displayName = p.SummonerName
		}

		players = append(players, PlayerInfo{
			SummonerName:   displayName,
			ChampionName:   p.ChampionName,
			Team:           p.Team,
			Position:       p.Position,
			Level:          p.Level,
			Kills:          p.Scores.Kills,
			Deaths:         p.Scores.Deaths,
			Assists:        p.Scores.Assists,
			CreepScore:     p.Scores.CreepScore,
			WardScore:      p.Scores.WardScore,
			Items:          items,
			SkinID:         p.SkinID,
			IsActivePlayer: t.isActivePlayer(p, &data.ActivePlayer),
			IsDead:         p.IsDead,
			RespawnTimer:   p.RespawnTimer,
		})
	}

	// Build name→champion lookup for the kill feed
	nameToChamp := make(map[string]string, len(data.AllPlayers))
	for i := range data.AllPlayers {
		p := &data.AllPlayers[i]
		name := p.RiotIdGameName
		if name == "" {
			name = p.SummonerName
		}
		nameToChamp[name] = p.ChampionName
	}

	// Extract kill feed + live events from game events
	var killFeed []KillEvent
	var liveEvents []LiveGameEvent
	for _, ev := range data.Events.Events {
		// Pass through objective/timeline event metadata for richer front-end estimation.
		liveEvents = append(liveEvents, LiveGameEvent{
			EventName:    ev.EventName,
			EventTime:    ev.EventTime,
			KillerName:   ev.KillerName,
			VictimName:   ev.VictimName,
			Assisters:    ev.Assisters,
			TurretKilled: ev.TurretKilled,
			InhibKilled:  ev.InhibKilled,
			MonsterType:  ev.MonsterType,
			DragonType:   ev.DragonType,
			Stolen:       ev.Stolen,
		})

		if ev.EventName != "ChampionKill" {
			continue
		}
		assistChamps := make([]string, 0, len(ev.Assisters))
		for _, a := range ev.Assisters {
			if champ, ok := nameToChamp[a]; ok {
				assistChamps = append(assistChamps, champ)
			} else {
				assistChamps = append(assistChamps, a)
			}
		}
		killerChamp := nameToChamp[ev.KillerName]
		victimChamp := nameToChamp[ev.VictimName]
		killerDisplay := ev.KillerName
		victimDisplay := ev.VictimName

		// Non-player killers (turrets, minions, monsters) use internal names
		if killerChamp == "" {
			killerChamp, killerDisplay = resolveNonPlayerKiller(ev.KillerName)
		}
		if victimChamp == "" {
			victimChamp, victimDisplay = resolveNonPlayerKiller(ev.VictimName)
		}

		killFeed = append(killFeed, KillEvent{
			EventTime:   ev.EventTime,
			KillerName:  killerDisplay,
			VictimName:  victimDisplay,
			Assisters:   assistChamps,
			KillerChamp: killerChamp,
			VictimChamp: victimChamp,
		})
	}

	return &LiveGameUpdate{
		Type:     "liveGameUpdate",
		GameTime: data.GameData.GameTime,
		GameMode: data.GameData.GameMode,
		Active: ActivePlayerInfo{
			SummonerName: activeName,
			Level:        data.ActivePlayer.Level,
			CurrentGold:  data.ActivePlayer.CurrentGold,
			Stats:        stats,
		},
		Players:  players,
		KillFeed: killFeed,
		LiveEvents: liveEvents,
	}
}
