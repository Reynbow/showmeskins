/**
 * Local WebSocket bridge server.
 *
 * Runs on localhost so the Model Viewer website (or any local client)
 * can connect and receive real-time champion-select updates.
 */

const { WebSocketServer } = require('ws');

class BridgeServer {
  constructor(port = 8234) {
    this.port = port;
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws, req) => {
      const origin = req.headers.origin || 'unknown';
      console.log(`[bridge] Website connected (origin: ${origin})`);
      this.clients.add(ws);

      // Send a welcome message so the website knows the connection is live
      ws.send(JSON.stringify({ type: 'connected', version: '1.0.0' }));

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('[bridge] Website disconnected');
      });

      ws.on('error', (err) => {
        console.error('[bridge] Client error:', err.message);
        this.clients.delete(ws);
      });
    });

    this.wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[bridge] Port ${this.port} is already in use. Is another instance running?`);
      } else {
        console.error('[bridge] Server error:', err.message);
      }
    });

    console.log(`[bridge] WebSocket server listening on ws://localhost:${this.port}`);
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(message);
      }
    }
  }

  get connectionCount() {
    return this.clients.size;
  }

  stop() {
    if (this.wss) {
      for (const client of this.clients) client.close();
      this.wss.close();
    }
  }
}

module.exports = { BridgeServer };
