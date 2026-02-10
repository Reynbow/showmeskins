# Show Me Skins Companion

A lightweight system-tray app that detects which champion and skin you're hovering in the League of Legends champion select lobby, and automatically opens the corresponding 3D model on the Show Me Skins website.

## How it works

1. The companion app detects the running League client process and connects to its local WebSocket API (LCU API)
2. It subscribes to champion-select session events and tracks which champion/skin the local player is hovering or has selected
3. It runs a local WebSocket server on `ws://localhost:8234` that the website automatically connects to
4. When the champion or skin changes, the website navigates to show that model in real time

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

1. Run the companion app — a hexagon icon appears in your system tray
2. Open the website (https://www.showmeskins.com)
3. Start a League of Legends game and enter champion select
4. The website will automatically update to show the champion and skin you're looking at

**Tray menu options:**
- Status display (waiting / connected / in champion select)
- Open Show Me Skins website
- Start on Login toggle
- Quit

## Notes

- The companion app uses the League Client's local API (LCU API), which runs on `127.0.0.1`
- It does **not** modify any game files or provide any competitive advantage
- The website connection is non-intrusive — if the companion isn't running, the website works normally
- Windows only (the LCU API is only accessible on the machine running the League client)
