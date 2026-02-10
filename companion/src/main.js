/**
 * Show Me Skins Companion — Electron main process.
 *
 * Sits in the system tray, connects to the League client's local API,
 * and bridges champion-select events to the website via a local
 * WebSocket server on port 8234.
 */

const { app, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { LCUConnector } = require('./lcu');
const { BridgeServer } = require('./bridge');

/* ── Configuration ────────────────────────────────────────────────────── */

const WEBSITE_URL = 'https://www.showmeskins.com';
const BRIDGE_PORT = 8234;
const LOGIN_ITEM_NAME = 'Show Me Skins Companion';

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

function isAutoLaunchEnabled() {
  return app.getLoginItemSettings({ name: LOGIN_ITEM_NAME }).openAtLogin;
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    name: LOGIN_ITEM_NAME,
  });
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
      label: 'Show Me Skins Companion',
      enabled: false,
      ...(menuIcon && { icon: menuIcon }),
    },
    { type: 'separator' },
    { label: currentStatus, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Show Me Skins',
      click: () => shell.openExternal(WEBSITE_URL),
    },
    { type: 'separator' },
    {
      label: 'Start on Login',
      type: 'checkbox',
      checked: isAutoLaunchEnabled(),
      click: (menuItem) => {
        setAutoLaunch(menuItem.checked);
      },
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
