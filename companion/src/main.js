/**
 * Show Me Skins Companion — Electron main process.
 *
 * Sits in the system tray, connects to the League client's local API,
 * and bridges champion-select events to the website via a local
 * WebSocket server on port 8234.
 */

const { app, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const { LCUConnector } = require('./lcu');
const { BridgeServer } = require('./bridge');

/* ── Configuration ────────────────────────────────────────────────────── */

const WEBSITE_URL = 'https://www.showmeskins.com';
const BRIDGE_PORT = 8234;
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VALUE_NAME = 'Show Me Skins Companion';

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

/* ── Auto-launch helpers ──────────────────────────────────────────────── */
// Read/write the same registry key the NSIS installer uses so the
// tray checkbox stays in sync with the installer's "start on login" option.

function isAutoLaunchEnabled() {
  try {
    const output = execSync(
      `reg query "${REG_KEY}" /v "${REG_VALUE_NAME}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return output.includes(REG_VALUE_NAME);
  } catch {
    // Key doesn't exist → not enabled
    return false;
  }
}

function setAutoLaunch(enabled) {
  try {
    if (enabled) {
      const exePath = process.execPath;
      execSync(
        `reg add "${REG_KEY}" /v "${REG_VALUE_NAME}" /t REG_SZ /d "\\"${exePath}\\"" /f`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } else {
      execSync(
        `reg delete "${REG_KEY}" /v "${REG_VALUE_NAME}" /f`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    }
  } catch (err) {
    console.error('[auto-launch] Failed to update registry:', err.message);
  }
}

/* ── Icon ─────────────────────────────────────────────────────────────── */

function getIcon() {
  // In packaged app, assets are in resources/assets/
  const locations = [
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(process.resourcesPath, 'assets', 'icon.png'),
  ];
  for (const loc of locations) {
    try {
      const img = nativeImage.createFromPath(loc);
      if (!img.isEmpty()) return img;
    } catch {
      /* try next */
    }
  }
  return nativeImage.createEmpty();
}

function getMenuIcon() {
  const icon = getIcon();
  return icon.isEmpty() ? undefined : icon.resize({ width: 16, height: 16 });
}

/* ── Tray ─────────────────────────────────────────────────────────────── */

function buildMenu() {
  const menuIcon = getMenuIcon();
  const template = [
    {
      label: 'Show Me Skins Companion (Beta)',
      enabled: false,
      ...(menuIcon && { icon: menuIcon }),
    },
    { label: currentStatus, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Show Me Skins',
      click: () => shell.openExternal(WEBSITE_URL),
    },
    {
      label: 'Start on Login',
      type: 'checkbox',
      checked: isAutoLaunchEnabled(),
      click: (menuItem) => {
        setAutoLaunch(menuItem.checked);
      },
    },
    {
      label: 'Quit',
      click: () => {
        lcu?.stop();
        bridge?.stop();
        app.quit();
      },
    },
  ];
  return Menu.buildFromTemplate(template);
}

function updateStatus(status) {
  currentStatus = status;
  if (tray) {
    tray.setContextMenu(buildMenu());
    tray.setToolTip(`Show Me Skins Companion – ${status}`);
  }
}

/* ── App lifecycle ────────────────────────────────────────────────────── */

app.whenReady().then(async () => {
  // Create tray icon
  tray = new Tray(getIcon());
  tray.setToolTip('Show Me Skins Companion');
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
