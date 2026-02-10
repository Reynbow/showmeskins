/**
 * LCU (League Client) API connector.
 *
 * Detects the running League client, authenticates via the local API,
 * subscribes to champion-select WebSocket events, and emits updates
 * whenever the local player's champion or skin changes.
 */

const { exec } = require('child_process');
const https = require('https');
const EventEmitter = require('events');
const WebSocket = require('ws');

const DDRAGON = 'https://ddragon.leagueoflegends.com';

class LCUConnector extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.token = null;
    this.ws = null;
    this.pollTimer = null;
    this.championMap = null; // numeric key → { id, name }
    this.lastUpdate = '';    // dedup key
    this.destroyed = false;
  }

  /* ── public ─────────────────────────────────────────────────────────── */

  async start() {
    await this.fetchChampionMap();
    this.pollForClient();
  }

  stop() {
    this.destroyed = true;
    clearInterval(this.pollTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }
  }

  /* ── Data Dragon champion list ──────────────────────────────────────── */

  async fetchChampionMap() {
    try {
      const raw = await httpGet(`${DDRAGON}/api/versions.json`);
      const version = JSON.parse(raw)[0];
      const data = JSON.parse(
        await httpGet(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`),
      );
      this.championMap = {};
      for (const [id, champ] of Object.entries(data.data)) {
        this.championMap[champ.key] = { id, name: champ.name };
      }
      console.log(`[lcu] Loaded ${Object.keys(this.championMap).length} champions from Data Dragon`);
    } catch (err) {
      console.error('[lcu] Failed to fetch champion data:', err.message);
      this.championMap = {};
    }
  }

  /* ── League client detection ────────────────────────────────────────── */

  pollForClient() {
    if (this.destroyed) return;
    this.emit('status', 'Waiting for League Client…');
    this.detectClient(); // check immediately
    this.pollTimer = setInterval(() => this.detectClient(), 5000);
  }

  detectClient() {
    if (this.destroyed) return;

    // Use PowerShell to read the LeagueClientUx command-line args
    const cmd =
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'LeagueClientUx.exe\'\\" | Select-Object -ExpandProperty CommandLine"';

    exec(cmd, { windowsHide: true }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) return;

      const portMatch = stdout.match(/--app-port=(\d+)/);
      const tokenMatch = stdout.match(/--remoting-auth-token=([^\s"]+)/);

      if (portMatch && tokenMatch) {
        this.port = portMatch[1];
        this.token = tokenMatch[1];
        clearInterval(this.pollTimer);
        this.connectToLCU();
      }
    });
  }

  /* ── LCU WebSocket connection ───────────────────────────────────────── */

  connectToLCU() {
    if (this.destroyed) return;
    this.emit('status', 'Connecting to League Client…');

    const auth = Buffer.from(`riot:${this.token}`).toString('base64');

    this.ws = new WebSocket(`wss://127.0.0.1:${this.port}/`, {
      headers: { Authorization: `Basic ${auth}` },
      rejectUnauthorized: false, // LCU uses a self-signed certificate
    });

    this.ws.on('open', () => {
      console.log('[lcu] Connected to League Client WebSocket');
      this.emit('status', 'Connected – Waiting for Champion Select…');

      // Subscribe to champion-select session events (WAMP opcode 5 = subscribe)
      this.ws.send(JSON.stringify([5, 'OnJsonApiEvent_lol-champ-select_v1_session']));
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // WAMP opcode 8 = event
        if (Array.isArray(msg) && msg[0] === 8) {
          this.handleEvent(msg[2]);
        }
      } catch {
        /* ignore parse errors */
      }
    });

    this.ws.on('close', () => {
      console.log('[lcu] WebSocket closed');
      this.ws = null;
      this.lastUpdate = '';
      if (!this.destroyed) {
        this.emit('status', 'Disconnected – Reconnecting…');
        setTimeout(() => this.pollForClient(), 3000);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[lcu] WebSocket error:', err.message);
    });
  }

  /* ── Event handling ─────────────────────────────────────────────────── */

  handleEvent(event) {
    if (!event) return;
    const { eventType, uri, data } = event;

    if (uri !== '/lol-champ-select/v1/session') return;

    if (eventType === 'Delete') {
      // Champion select ended
      this.lastUpdate = '';
      this.emit('status', 'Connected – Waiting for Champion Select…');
      this.emit('champSelect', { type: 'champSelectEnd' });
      return;
    }

    if (eventType === 'Update' || eventType === 'Create') {
      this.emit('status', 'In Champion Select');
      this.processSession(data);
    }
  }

  processSession(session) {
    if (!session || !session.myTeam) return;

    const localCellId = session.localPlayerCellId;
    const localPlayer = session.myTeam.find((p) => p.cellId === localCellId);
    if (!localPlayer) return;

    let championKey = localPlayer.championId;
    let selectedSkinId = localPlayer.selectedSkinId;

    // If champion not yet locked in, check the actions array for what's being hovered
    if (!championKey || championKey === 0) {
      if (session.actions) {
        for (const group of session.actions) {
          for (const action of group) {
            if (
              action.actorCellId === localCellId &&
              action.type === 'pick' &&
              action.championId > 0
            ) {
              championKey = action.championId;
              selectedSkinId = championKey * 1000; // base skin while hovering
              break;
            }
          }
          if (championKey > 0) break;
        }
      }
    }

    // Fall back to pick intent
    if (!championKey || championKey === 0) {
      championKey = localPlayer.championPickIntent;
      if (championKey > 0) {
        selectedSkinId = championKey * 1000;
      }
    }

    if (!championKey || championKey === 0) return;

    const champInfo = this.championMap?.[String(championKey)];
    if (!champInfo) return;

    const skinNum = selectedSkinId ? selectedSkinId % 1000 : 0;

    // De-duplicate: don't re-emit if nothing changed
    const key = `${champInfo.id}:${skinNum}`;
    if (key === this.lastUpdate) return;
    this.lastUpdate = key;

    console.log(`[lcu] Champion select: ${champInfo.name} skin #${skinNum}`);

    this.emit('champSelect', {
      type: 'champSelectUpdate',
      championId: champInfo.id,      // Data Dragon ID, e.g. "Aatrox"
      championName: champInfo.name,   // Display name, e.g. "Aatrox"
      championKey: String(championKey), // Numeric key, e.g. "266"
      skinNum,
      skinId: String(selectedSkinId || championKey * 1000),
    });
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          return httpGet(res.headers.location).then(resolve, reject);
        }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

module.exports = { LCUConnector };
