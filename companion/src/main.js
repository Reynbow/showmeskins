/**
 * LoL Model Viewer Companion — Electron main process.
 *
 * Sits in the system tray, connects to the League client's local API,
 * and bridges champion-select events to the Model Viewer website via
 * a local WebSocket server on port 8234.
 */

const { app, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { LCUConnector } = require('./lcu');
const { BridgeServer } = require('./bridge');

/* ── Configuration ────────────────────────────────────────────────────── */

const WEBSITE_URL = 'https://www.showmeskins.com';
const BRIDGE_PORT = 8234;

/* ── State ────────────────────────────────────────────────────────────── */

let tray = null;
let lcu = null;
let bridge = null;
let currentStatus = 'Starting…';

/* ── Single instance lock ─────────────────────────────────────────────── */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('Another instance is already running. Exiting.');
  app.quit();
}

/* ── Tray ─────────────────────────────────────────────────────────────── */

function getIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  try {
    return nativeImage.createFromPath(iconPath);
  } catch {
    // Fallback: create a simple 16×16 empty icon (shouldn't happen)
    return nativeImage.createEmpty();
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'LoL Model Viewer Companion',
      enabled: false,
      icon: nativeImage
        .createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'))
        .resize({ width: 16, height: 16 }),
    },
    { type: 'separator' },
    { label: currentStatus, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Model Viewer',
      click: () => shell.openExternal(WEBSITE_URL),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        lcu?.stop();
        bridge?.stop();
        app.quit();
      },
    },
  ]);
}

function updateStatus(status) {
  currentStatus = status;
  if (tray) {
    tray.setContextMenu(buildMenu());
    tray.setToolTip(`Model Viewer Companion – ${status}`);
  }
}

/* ── App lifecycle ────────────────────────────────────────────────────── */

app.whenReady().then(async () => {
  // Create tray icon
  tray = new Tray(getIcon());
  tray.setToolTip('LoL Model Viewer Companion');
  tray.setContextMenu(buildMenu());

  // Double-click tray → open website
  tray.on('double-click', () => shell.openExternal(WEBSITE_URL));

  // Start the WebSocket bridge for the website
  bridge = new BridgeServer(BRIDGE_PORT);
  bridge.start();

  // Start the LCU connector
  lcu = new LCUConnector();

  lcu.on('status', (status) => {
    updateStatus(status);
  });

  lcu.on('champSelect', (data) => {
    bridge.broadcast(data);
  });

  await lcu.start();
});

// Keep the app running even with no windows open
app.on('window-all-closed', (e) => e.preventDefault());
