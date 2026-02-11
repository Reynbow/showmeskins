# Show Me Skins Companion

A lightweight system-tray app that connects to League of Legends and syncs with Show Me Skins for champion select, live game tracking, and post-game summaries.

## Features

- **Champion Select Sync** — Detects which champion and skin you're hovering in the lobby and opens the 3D model on the website in real time
- **Live Game Scoreboard** — Tracks all 10 players' KDA, items, levels, CS, ward score, and champion stats during the match
- **Kill Feed** — Real-time champion kills, turret/dragon/baron takedowns with assist tracking
- **Post-Game Summary** — Win/loss result, final scoreboard, and match MVP

## How it works

1. The companion app connects to the League client (LCU API) and the Riot Live Client Data API during games
2. It subscribes to champion-select events and polls the live game API for scoreboard and kill feed data
3. It runs a local WebSocket server on `ws://localhost:8234` that the website automatically connects to
4. The website displays real-time champion picks, live scoreboard, kill feed, and post-game summary

## Building

Requires [Go](https://go.dev/dl/) 1.21+ and (optionally) [NSIS](https://nsis.sourceforge.io/) for the installer.

```bash
# Build the binary only
go build -ldflags="-s -w -H windowsgui" -o "dist\Show Me Skins Companion.exe" .

# Build binary + installer (Windows)
build.bat
```

The binary is a standalone `.exe` (~7 MB) with no runtime dependencies.
The NSIS installer compresses it further to ~2.5 MB.

## Usage

1. Run the companion app. A hexagon icon will appear in your system tray
2. Open the website (https://www.showmeskins.com)
3. Start a League of Legends game — the website syncs champion select, then live scoreboard and kill feed during the match, then post-game summary when it ends

**Tray menu options:**
- Status display (waiting / in champion select / in game)
- Open Show Me Skins website
- Start on Login toggle
- Quit

## Notes

- The companion app uses the League Client's local API (LCU API), which runs on `127.0.0.1`
- It does **not** modify any game files or provide any competitive advantage
- The website connection is non-intrusive. If the companion isn't running, the website works normally
- Windows only (the LCU API is only accessible on the machine running the League client)
