package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// LogEntry represents a single log line for the debug console.
type LogEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Message string `json:"msg"`
	Attrs   string `json:"attrs,omitempty"`
}

// DebugBroadcaster collects log entries and streams them to debug console clients.
type DebugBroadcaster struct {
	clients map[*websocket.Conn]bool
	mu      sync.RWMutex
	buffer  []LogEntry // ring buffer of recent entries
	maxBuf  int
}

func NewDebugBroadcaster() *DebugBroadcaster {
	return &DebugBroadcaster{
		clients: make(map[*websocket.Conn]bool),
		maxBuf:  500,
	}
}

// AddEntry adds a log entry and broadcasts to all connected debug clients.
func (db *DebugBroadcaster) AddEntry(entry LogEntry) {
	db.mu.Lock()
	db.buffer = append(db.buffer, entry)
	if len(db.buffer) > db.maxBuf {
		db.buffer = db.buffer[len(db.buffer)-db.maxBuf:]
	}
	clients := make([]*websocket.Conn, 0, len(db.clients))
	for c := range db.clients {
		clients = append(clients, c)
	}
	db.mu.Unlock()

	// Wrap as HTML fragment for the debug console
	html := fmt.Sprintf(
		`<div id="log-new" hx-swap-oob="afterbegin:#log-entries" class="log-entry log-%s"><span class="log-time">%s</span><span class="log-level">%s</span><span class="log-msg">%s</span><span class="log-attrs">%s</span></div>`,
		entry.Level, entry.Time, entry.Level, entry.Message, entry.Attrs,
	)

	msg, _ := json.Marshal(map[string]string{"type": "html", "html": html})

	for _, conn := range clients {
		err := conn.Write(context.Background(), websocket.MessageText, msg)
		if err != nil {
			db.mu.Lock()
			delete(db.clients, conn)
			db.mu.Unlock()
		}
	}
}

// RecentEntries returns the buffered log entries.
func (db *DebugBroadcaster) RecentEntries() []LogEntry {
	db.mu.RLock()
	defer db.mu.RUnlock()
	entries := make([]LogEntry, len(db.buffer))
	copy(entries, db.buffer)
	return entries
}

func (db *DebugBroadcaster) addClient(conn *websocket.Conn) {
	db.mu.Lock()
	db.clients[conn] = true
	db.mu.Unlock()
}

func (db *DebugBroadcaster) removeClient(conn *websocket.Conn) {
	db.mu.Lock()
	delete(db.clients, conn)
	db.mu.Unlock()
}

func (s *Server) handleDebug(w http.ResponseWriter, r *http.Request) {
	entries := s.debug.RecentEntries()
	s.renderPage(w, r, "debug.html", map[string]any{
		"Title":   "Debug Console",
		"Active":  "debug",
		"Entries": entries,
	})
}

func (s *Server) handleDebugWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		s.logger.Error("debug websocket accept failed", "error", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	s.debug.addClient(conn)
	defer s.debug.removeClient(conn)

	// Keep alive until disconnect
	ctx := r.Context()
	for {
		_, _, err := conn.Read(ctx)
		if err != nil {
			return
		}
	}
}

// DebugLogWriter is an io.Writer that captures log output and sends it to the debug broadcaster.
type DebugLogWriter struct {
	Debug *DebugBroadcaster
}

func (w *DebugLogWriter) Write(p []byte) (n int, err error) {
	// Parse slog text output
	entry := LogEntry{
		Time:    time.Now().Format("15:04:05.000"),
		Level:   "INFO",
		Message: string(p),
	}

	// Try to parse structured fields from slog text format
	text := string(p)
	var parsed map[string]any
	if json.Unmarshal(p, &parsed) == nil {
		if t, ok := parsed["time"].(string); ok {
			if pt, err := time.Parse(time.RFC3339Nano, t); err == nil {
				entry.Time = pt.Format("15:04:05.000")
			}
		}
		if l, ok := parsed["level"].(string); ok {
			entry.Level = l
		}
		if m, ok := parsed["msg"].(string); ok {
			entry.Message = m
		}
		// Collect remaining attrs
		attrs := make(map[string]any)
		for k, v := range parsed {
			if k != "time" && k != "level" && k != "msg" {
				attrs[k] = v
			}
		}
		if len(attrs) > 0 {
			ab, _ := json.Marshal(attrs)
			entry.Attrs = string(ab)
		}
	} else {
		// Parse slog text format: time=... level=... msg=... key=value...
		entry = parseSlogText(text)
	}

	w.Debug.AddEntry(entry)

	// Also write to stdout
	fmt.Print(text)
	return len(p), nil
}

func parseSlogText(text string) LogEntry {
	entry := LogEntry{
		Time:    time.Now().Format("15:04:05.000"),
		Level:   "INFO",
		Message: text,
	}

	// Simple parser for slog text: time=X level=X msg="X" key=value...
	fields := make(map[string]string)
	remaining := text
	for len(remaining) > 0 {
		// Find key=
		eqIdx := -1
		for i, c := range remaining {
			if c == '=' {
				eqIdx = i
				break
			}
		}
		if eqIdx < 0 {
			break
		}

		// Find key start (after last space)
		keyStart := 0
		for i := eqIdx - 1; i >= 0; i-- {
			if remaining[i] == ' ' || remaining[i] == '\n' {
				keyStart = i + 1
				break
			}
		}
		key := remaining[keyStart:eqIdx]
		remaining = remaining[eqIdx+1:]

		// Parse value (quoted or unquoted)
		var value string
		if len(remaining) > 0 && remaining[0] == '"' {
			// Quoted value
			endQuote := 1
			for endQuote < len(remaining) {
				if remaining[endQuote] == '"' && remaining[endQuote-1] != '\\' {
					break
				}
				endQuote++
			}
			if endQuote < len(remaining) {
				value = remaining[1:endQuote]
				remaining = remaining[endQuote+1:]
			}
		} else {
			// Unquoted value -- until next space or EOL
			spaceIdx := len(remaining)
			for i, c := range remaining {
				if c == ' ' || c == '\n' {
					spaceIdx = i
					break
				}
			}
			value = remaining[:spaceIdx]
			if spaceIdx < len(remaining) {
				remaining = remaining[spaceIdx+1:]
			} else {
				remaining = ""
			}
		}

		fields[key] = value
	}

	if t, ok := fields["time"]; ok {
		if pt, err := time.Parse(time.RFC3339Nano, t); err == nil {
			entry.Time = pt.Format("15:04:05.000")
		} else if pt, err := time.Parse("2006-01-02T15:04:05.000-07:00", t); err == nil {
			entry.Time = pt.Format("15:04:05.000")
		}
	}
	if l, ok := fields["level"]; ok {
		entry.Level = l
	}
	if m, ok := fields["msg"]; ok {
		entry.Message = m
	}

	// Remaining fields as attrs
	attrs := make(map[string]string)
	for k, v := range fields {
		if k != "time" && k != "level" && k != "msg" {
			attrs[k] = v
		}
	}
	if len(attrs) > 0 {
		ab, _ := json.Marshal(attrs)
		entry.Attrs = string(ab)
	}

	return entry
}
