package main

import (
	"io"
	"log"
	"os"
	"sync/atomic"
	"syscall"
	"unsafe"

	"github.com/getlantern/systray"
	"github.com/pkg/browser"
	"golang.org/x/sys/windows/registry"
)

const (
	websiteURL   = "https://www.showmeskins.com"
	bridgePort   = "8234"
	regKey       = `Software\Microsoft\Windows\CurrentVersion\Run`
	regValueName = "Show Me Skins Companion"
)

// Version is set at build time via -ldflags "-X main.Version=0.3.1"
var Version = "0.0.0"

var (
	lcu             *LCUConnector
	liveGame        *LiveGameTracker
	bridgeSrv       *BridgeServer
	statusItem      *systray.MenuItem
	updateItem      *systray.MenuItem
	updateReadyItem *systray.MenuItem
)

// ── Single instance lock ────────────────────────────────────────────────

var (
	kernel32     = syscall.NewLazyDLL("kernel32.dll")
	createMutexW = kernel32.NewProc("CreateMutexW")
	getLastError = kernel32.NewProc("GetLastError")
	allocConsole = kernel32.NewProc("AllocConsole")
	freeConsole  = kernel32.NewProc("FreeConsole")
)

const errorAlreadyExists = 183

func acquireSingleInstanceLock() bool {
	name, _ := syscall.UTF16PtrFromString("Global\\ShowMeSkinsCompanion")
	ret, _, _ := createMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if ret == 0 {
		return false
	}
	// Check if another instance already owns the mutex
	code, _, _ := getLastError.Call()
	if code == errorAlreadyExists {
		log.Println("Another instance is already running. Exiting.")
		return false
	}
	return true
}

// ── Auto-launch helpers ─────────────────────────────────────────────────

func isAutoLaunchEnabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, regKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()

	_, _, err = k.GetStringValue(regValueName)
	return err == nil
}

func setAutoLaunch(enabled bool) {
	if enabled {
		exePath, err := os.Executable()
		if err != nil {
			log.Printf("[auto-launch] Failed to get exe path: %v", err)
			return
		}
		k, err := registry.OpenKey(registry.CURRENT_USER, regKey, registry.SET_VALUE)
		if err != nil {
			log.Printf("[auto-launch] Failed to open registry key: %v", err)
			return
		}
		defer k.Close()

		if err := k.SetStringValue(regValueName, `"`+exePath+`"`); err != nil {
			log.Printf("[auto-launch] Failed to set registry value: %v", err)
		}
	} else {
		k, err := registry.OpenKey(registry.CURRENT_USER, regKey, registry.SET_VALUE)
		if err != nil {
			return
		}
		defer k.Close()
		k.DeleteValue(regValueName)
	}
}

// ── Console show/hide (Windows GUI app: no console by default) ────────────

func showConsole() bool {
	r0, _, _ := allocConsole.Call()
	if r0 == 0 {
		return false // already has console or failed
	}
	hOut, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	if err != nil {
		freeConsole.Call()
		return false
	}
	hErr, _ := syscall.GetStdHandle(syscall.STD_ERROR_HANDLE)
	os.Stdout = os.NewFile(uintptr(hOut), "stdout")
	os.Stderr = os.NewFile(uintptr(hErr), "stderr")
	log.SetOutput(os.Stderr)
	return true
}

func hideConsole() {
	log.SetOutput(io.Discard)
	freeConsole.Call()
}

// ── Tray ────────────────────────────────────────────────────────────────

func onReady() {
	// Set tray icon
	systray.SetIcon(pngToICO(iconPNG))
	tooltipPrefix := "Dev Build"
	if Version != "0.0.0" {
		tooltipPrefix = "v" + Version
	}
	systray.SetTooltip(tooltipPrefix)

	// Build menu
	titleText := "Show Me Skins Companion (Beta)"
	if Version != "0.0.0" {
		titleText += " v" + Version
	}
	titleItem := systray.AddMenuItem(titleText, "")
	titleItem.Disable()

	statusItem = systray.AddMenuItem("Starting…", "")
	statusItem.Disable()

	systray.AddSeparator()

	openItem := systray.AddMenuItem("Open Show Me Skins", "Open the website in your browser")

	updateItem = systray.AddMenuItem("Check for Updates", "Check for a new version on GitHub")
	updateReadyItem = systray.AddMenuItem("Update available – click to install", "")
	updateReadyItem.Hide()

	autoStartItem := systray.AddMenuItemCheckbox("Start on Login", "Launch automatically when you log in", isAutoLaunchEnabled())
	showConsoleItem := systray.AddMenuItemCheckbox("Show Console", "Show or hide the debug console (logs, connection status)", false)

	quitItem := systray.AddMenuItem("Quit", "Exit the companion app")

	// Start the WebSocket bridge
	bridgeSrv = NewBridgeServer(bridgePort)
	bridgeSrv.Start()

	// Status callback shared by LCU and live game tracker.
	// inChampSelect prevents LiveGame from overwriting "In Champion Select" when
	// the user is in champ select (e.g. after a game ends and they queue again).
	var inChampSelect atomic.Bool
	applyStatus := func(status string) {
		statusItem.SetTitle(status)
		tt := tooltipPrefix + " – " + status
		systray.SetTooltip(tt)
	}
	lcuSetStatus := func(status string) {
		inChampSelect.Store(status == "In Champion Select")
		applyStatus(status)
	}
	liveGameSetStatus := func(status string) {
		if status == "Connected – Waiting for Champion Select…" && inChampSelect.Load() {
			return // Don't overwrite "In Champion Select" when user is in champ select
		}
		applyStatus(status)
	}

	// Start the LCU connector (champion select detection)
	lcu = NewLCUConnector(
		lcuSetStatus,
		func(update ChampSelectUpdate) {
			bridgeSrv.Broadcast(update)
		},
		func(info AccountInfo) {
			bridgeSrv.Broadcast(map[string]interface{}{
				"type":        "accountInfo",
				"puuid":       info.PUUID,
				"displayName": info.DisplayName,
				"summonerId":  info.SummonerID,
				"accountId":   info.AccountID,
				"platformId":  info.PlatformID,
			})
		},
	)
	go lcu.Start()

	// Start the live game tracker (in-game items & stats)
	liveGame = NewLiveGameTracker(
		liveGameSetStatus,
		func(update LiveGameUpdate) {
			if lcu != nil {
				update.PartyMembers = lcu.PartyMembers()
			}
			bridgeSrv.Broadcast(update)
		},
		func(result string) {
			if lcu != nil {
				lcu.ResetChampSelectDedup()
			}
			msg := map[string]string{"type": "liveGameEnd"}
			if result != "" {
				msg["gameResult"] = result
			}
			bridgeSrv.Broadcast(msg)
		},
	)
	liveGame.Start()

	// Update checker: periodic check and on menu click
	go runUpdateChecker(updateItem, updateReadyItem, applyStatus)

	// Handle menu clicks
	go func() {
		for {
			select {
			case <-openItem.ClickedCh:
				browser.OpenURL(websiteURL)
			case <-updateItem.ClickedCh:
				checkUpdateAndNotify(updateItem, updateReadyItem, applyStatus)
			case <-updateReadyItem.ClickedCh:
				applyUpdate(updateReadyItem)
			case <-autoStartItem.ClickedCh:
				if autoStartItem.Checked() {
					autoStartItem.Uncheck()
					setAutoLaunch(false)
				} else {
					autoStartItem.Check()
					setAutoLaunch(true)
				}
			case <-showConsoleItem.ClickedCh:
				if showConsoleItem.Checked() {
					if showConsole() {
						log.Println("[console] Debug console shown")
					} else {
						showConsoleItem.Uncheck()
					}
				} else {
					hideConsole()
				}
			case <-quitItem.ClickedCh:
				systray.Quit()
			}
		}
	}()
}

func onExit() {
	if liveGame != nil {
		liveGame.Stop()
	}
	if lcu != nil {
		lcu.Stop()
	}
	if bridgeSrv != nil {
		bridgeSrv.Stop()
	}
}

// ── Entry point ─────────────────────────────────────────────────────────

func main() {
	// No console by default (windowsgui); discard logs until user enables "Show Console"
	log.SetOutput(io.Discard)

	if !acquireSingleInstanceLock() {
		os.Exit(0)
	}

	systray.Run(onReady, onExit)
}
