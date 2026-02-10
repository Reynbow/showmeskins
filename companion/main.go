package main

import (
	"log"
	"os"
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

var (
	lcu         *LCUConnector
	bridgeSrv   *BridgeServer
	statusItem  *systray.MenuItem
)

// ── Single instance lock ────────────────────────────────────────────────

var (
	kernel32       = syscall.NewLazyDLL("kernel32.dll")
	createMutexW   = kernel32.NewProc("CreateMutexW")
	getLastError   = kernel32.NewProc("GetLastError")
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

// ── Tray ────────────────────────────────────────────────────────────────

func onReady() {
	// Set tray icon
	systray.SetIcon(pngToICO(iconPNG))
	systray.SetTooltip("Show Me Skins Companion")

	// Build menu
	titleItem := systray.AddMenuItem("Show Me Skins Companion (Beta)", "")
	titleItem.Disable()

	statusItem = systray.AddMenuItem("Starting…", "")
	statusItem.Disable()

	systray.AddSeparator()

	openItem := systray.AddMenuItem("Open Show Me Skins", "Open the website in your browser")

	autoStartItem := systray.AddMenuItemCheckbox("Start on Login", "Launch automatically when you log in", isAutoLaunchEnabled())

	quitItem := systray.AddMenuItem("Quit", "Exit the companion app")

	// Start the WebSocket bridge
	bridgeSrv = NewBridgeServer(bridgePort)
	bridgeSrv.Start()

	// Start the LCU connector
	lcu = NewLCUConnector(
		func(status string) {
			statusItem.SetTitle(status)
			systray.SetTooltip("Show Me Skins Companion – " + status)
		},
		func(update ChampSelectUpdate) {
			bridgeSrv.Broadcast(update)
		},
	)
	go lcu.Start()

	// Handle menu clicks
	go func() {
		for {
			select {
			case <-openItem.ClickedCh:
				browser.OpenURL(websiteURL)
			case <-autoStartItem.ClickedCh:
				if autoStartItem.Checked() {
					autoStartItem.Uncheck()
					setAutoLaunch(false)
				} else {
					autoStartItem.Check()
					setAutoLaunch(true)
				}
			case <-quitItem.ClickedCh:
				systray.Quit()
			}
		}
	}()
}

func onExit() {
	if lcu != nil {
		lcu.Stop()
	}
	if bridgeSrv != nil {
		bridgeSrv.Stop()
	}
}

// ── Entry point ─────────────────────────────────────────────────────────

func main() {
	if !acquireSingleInstanceLock() {
		os.Exit(0)
	}

	systray.Run(onReady, onExit)
}
