# LoL Model Viewer Companion

A lightweight system-tray app that detects which champion and skin you're hovering in the League of Legends champion select lobby, and automatically opens the corresponding 3D model on the Model Viewer website.

## How it works

1. The companion app detects the running League client process and connects to its local WebSocket API (LCU API)
2. It subscribes to champion-select session events and tracks which champion/skin the local player is hovering or has selected
3. It runs a local WebSocket server on `ws://localhost:8234` that the Model Viewer website automatically connects to
4. When the champion or skin changes, the website navigates to show that model in real time

## Setup

```bash
cd companion
npm install      # installs dependencies and generates the tray icon
npm start        # launches the companion app in the system tray
```

## Usage

1. Start the companion app (`npm start`) — a gold hexagon icon appears in your system tray
2. Open the website (https://www.showmeskins.com)
3. Start a League of Legends game and enter champion select
4. The website will automatically update to show the champion and skin you're looking at

**Tray menu options:**
- Status display (waiting / connected / in champion select)
- Open Model Viewer website
- Quit

Double-click the tray icon to open the website.

## Building a standalone .exe

```bash
npm run dist     # creates a portable .exe in the dist/ folder
```

## Notes

- The companion app uses the League Client's local API (LCU API), which runs on `127.0.0.1`
- It does **not** modify any game files or provide any competitive advantage
- The website connection is non-intrusive — if the companion isn't running, the website works normally
- Windows only (the LCU API is only accessible on the machine running the League client)
