package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/coder/websocket"
)

type Client struct {
	id     string
	conn   *websocket.Conn
	hub    *Hub
	send   chan []byte
	topics map[string]bool
	mu     sync.RWMutex
	logger *slog.Logger
}

func NewClient(id string, conn *websocket.Conn, hub *Hub, logger *slog.Logger) *Client {
	return &Client{
		id:     id,
		conn:   conn,
		hub:    hub,
		send:   make(chan []byte, 64),
		topics: make(map[string]bool),
		logger: logger.With("client", id),
	}
}

func (c *Client) ID() string { return c.id }

func (c *Client) Topics() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	topics := make([]string, 0, len(c.topics))
	for t := range c.topics {
		topics = append(topics, t)
	}
	return topics
}

func (c *Client) AddTopic(topic string) {
	c.mu.Lock()
	c.topics[topic] = true
	c.mu.Unlock()
}

func (c *Client) RemoveTopic(topic string) {
	c.mu.Lock()
	delete(c.topics, topic)
	c.mu.Unlock()
}

func (c *Client) HasTopic(topic string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.topics[topic]
}

// ReadPump reads messages from the WebSocket and processes subscribe/unsubscribe commands.
func (c *Client) ReadPump(ctx context.Context) {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			c.logger.Debug("read error", "error", err)
			return
		}

		var msg InboundMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			c.logger.Debug("invalid message", "error", err)
			continue
		}

		switch msg.Type {
		case MsgSubscribe:
			topic := msg.Topic
			if topic == "" && msg.Symbol != "" {
				topic = "quote:" + msg.Symbol
			}
			if topic != "" {
				c.hub.Subscribe(c, topic)
			}
		case MsgUnsubscribe:
			topic := msg.Topic
			if topic == "" && msg.Symbol != "" {
				topic = "quote:" + msg.Symbol
			}
			if topic != "" {
				c.hub.Unsubscribe(c, topic)
			}
		}
	}
}

// WritePump sends messages from the send channel to the WebSocket.
func (c *Client) WritePump(ctx context.Context) {
	defer c.conn.Close(websocket.StatusNormalClosure, "")

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			if err := c.conn.Write(ctx, websocket.MessageText, msg); err != nil {
				c.logger.Debug("write error", "error", err)
				return
			}
		}
	}
}

// Send queues a message for sending. Returns false if the send buffer is full.
func (c *Client) Send(data []byte) bool {
	select {
	case c.send <- data:
		return true
	default:
		c.logger.Warn("send buffer full, dropping message")
		return false
	}
}
