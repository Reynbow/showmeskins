package main

import (
	"encoding/json"
	"github.com/getlantern/systray"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	ghReleasesURL = "https://api.github.com/repos/Reynbow/showmeskins/releases/latest"
	updateAsset   = "x9report.Companion.Setup.exe"
	checkInterval = 6 * time.Hour
)

type ghRelease struct {
	TagName string `json:"tag_name"`
	Assets []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

// versionLess returns true if a < b (e.g. "0.3.1" < "0.3.2")
func versionLess(a, b string) bool {
	aparts := strings.Split(strings.TrimPrefix(a, "v"), ".")
	bparts := strings.Split(strings.TrimPrefix(b, "v"), ".")
	for i := 0; i < len(aparts) || i < len(bparts); i++ {
		var an, bn int
		if i < len(aparts) {
			an, _ = strconv.Atoi(aparts[i])
		}
		if i < len(bparts) {
			bn, _ = strconv.Atoi(bparts[i])
		}
		if an < bn {
			return true
		}
		if an > bn {
			return false
		}
	}
	return false
}

// parseReleaseVersion extracts "0.3.1" from "companion-v0.3.1"
func parseReleaseVersion(tag string) string {
	return strings.TrimPrefix(tag, "companion-v")
}

func fetchLatestRelease() (version string, downloadURL string, err error) {
	req, err := http.NewRequest("GET", ghReleasesURL, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return "", "", err
	}

	ver := parseReleaseVersion(rel.TagName)
	for _, a := range rel.Assets {
		if a.Name == updateAsset {
			return ver, a.BrowserDownloadURL, nil
		}
	}
	return ver, "", fmt.Errorf("asset %s not found in release", updateAsset)
}

func downloadAndRunInstaller(url string) error {
	tmpDir := os.TempDir()
	path := filepath.Join(tmpDir, "x9report.Companion.Setup.exe")

	log.Printf("[update] Downloading from %s", url)
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned %d", resp.StatusCode)
	}

	f, err := os.Create(path)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, resp.Body)
	f.Close()
	if err != nil {
		os.Remove(path)
		return err
	}

	log.Printf("[update] Launching installer")
	cmd := exec.Command(path)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		os.Remove(path)
		return err
	}
	return nil
}

// Stored when update is found so we can apply it on click
var (
	pendingUpdateVersion string
	pendingUpdateURL     string
)

func runUpdateChecker(checkItem, readyItem *systray.MenuItem, setStatus func(string)) {
	// Initial check after a short delay (let the app settle)
	time.Sleep(30 * time.Second)
	checkAndMaybeShowUpdate(checkItem, readyItem, setStatus)

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	for range ticker.C {
		checkAndMaybeShowUpdate(checkItem, readyItem, setStatus)
	}
}

func checkUpdateAndNotify(checkItem, readyItem *systray.MenuItem, setStatus func(string)) {
	checkItem.SetTitle("Checking…")
	checkItem.Disable()
	defer checkItem.SetTitle("Check for Updates")
	defer checkItem.Enable()

	checkAndMaybeShowUpdate(checkItem, readyItem, setStatus)
}

func checkAndMaybeShowUpdate(checkItem, readyItem *systray.MenuItem, setStatus func(string)) {
	newVer, url, err := fetchLatestRelease()
	if err != nil {
		log.Printf("[update] Check failed: %v", err)
		return
	}

	current := Version
	if current == "0.0.0" {
		return // dev build, skip
	}

	if versionLess(current, newVer) {
		pendingUpdateVersion = newVer
		pendingUpdateURL = url
		readyItem.SetTitle(fmt.Sprintf("Update to v%s – click to install", newVer))
		readyItem.Show()
		setStatus("Update available: v" + newVer)
		log.Printf("[update] New version v%s available", newVer)
	}
}

func applyUpdate(readyItem *systray.MenuItem) {
	if pendingUpdateURL == "" {
		return
	}
	readyItem.SetTitle("Downloading…")
	readyItem.Disable()

	if err := downloadAndRunInstaller(pendingUpdateURL); err != nil {
		log.Printf("[update] Failed: %v", err)
		readyItem.SetTitle("Update failed – try again")
		readyItem.Enable()
		return
	}

	// Installer will replace us; exit so it can proceed
	systray.Quit()
}
