package server

import (
	"fmt"
	"net/http"
	"sync/atomic"

	"github.com/coder/websocket"

	"stocktopus/internal/hub"
)

var clientCounter atomic.Uint64

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Allow connections from any origin in dev
	})
	if err != nil {
		s.logger.Error("websocket accept failed", "error", err)
		return
	}

	id := fmt.Sprintf("client-%d", clientCounter.Add(1))
	client := hub.NewClient(id, conn, s.hub, s.logger)

	s.hub.Register(client)

	ctx := r.Context()
	go client.WritePump(ctx)
	client.ReadPump(ctx) // blocks until disconnect
}
