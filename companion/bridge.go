package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// BridgeServer runs a local WebSocket server so the Show Me Skins website
// (or any local client) can connect and receive real-time champion-select updates.
type BridgeServer struct {
	port     string
	upgrader websocket.Upgrader
	onSetSkin func(skinID int)

	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}
}

// NewBridgeServer creates a new bridge on the given port (e.g. "8234").
func NewBridgeServer(port string, onSetSkin func(skinID int)) *BridgeServer {
	return &BridgeServer{
		port: port,
		onSetSkin: onSetSkin,
		upgrader: websocket.Upgrader{
			// Allow connections from any origin (the website runs on a different domain)
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		clients: make(map[*websocket.Conn]struct{}),
	}
}

// Start begins listening for WebSocket connections in a background goroutine.
func (b *BridgeServer) Start() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", b.handleWS)

	go func() {
		addr := "127.0.0.1:" + b.port
		log.Printf("[bridge] WebSocket server listening on ws://%s", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Printf("[bridge] Server error: %v", err)
		}
	}()
}

func (b *BridgeServer) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[bridge] Upgrade error: %v", err)
		return
	}

	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "unknown"
	}
	log.Printf("[bridge] Website connected (origin: %s)", origin)

	b.mu.Lock()
	b.clients[conn] = struct{}{}
	b.mu.Unlock()

	// Send welcome message so the website knows the connection is live
	welcome, _ := json.Marshal(map[string]string{
		"type":    "connected",
		"version": Version,
	})
	conn.WriteMessage(websocket.TextMessage, welcome)

	// Read loop (keeps connection alive, handles close)
	go func() {
		defer func() {
			b.mu.Lock()
			delete(b.clients, conn)
			b.mu.Unlock()
			conn.Close()
			log.Println("[bridge] Website disconnected")
		}()
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				break
			}
			b.handleClientMessage(raw)
		}
	}()
}

func (b *BridgeServer) handleClientMessage(raw []byte) {
	var msg struct {
		Type   string `json:"type"`
		SkinID int    `json:"skinId"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return
	}
	if msg.Type == "setSkin" && msg.SkinID > 0 && b.onSetSkin != nil {
		go b.onSetSkin(msg.SkinID)
	}
}

// Broadcast sends a JSON message to all connected clients.
func (b *BridgeServer) Broadcast(data interface{}) {
	msg, err := json.Marshal(data)
	if err != nil {
		log.Printf("[bridge] Marshal error: %v", err)
		return
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	for conn := range b.clients {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			conn.Close()
			delete(b.clients, conn)
		}
	}
}

// ConnectionCount returns the number of connected clients.
func (b *BridgeServer) ConnectionCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.clients)
}

// Stop closes all client connections and shuts down the server.
func (b *BridgeServer) Stop() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for conn := range b.clients {
		conn.Close()
		delete(b.clients, conn)
	}
}
