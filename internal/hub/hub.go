package hub

import (
	"encoding/json"
	"log/slog"
	"sync"
)

// SubscriptionHandler is called when the first client subscribes to a topic
// or the last client unsubscribes. This allows the poller to start/stop
// watching symbols based on demand.
type SubscriptionHandler interface {
	OnFirstSubscribe(topic string)
	OnLastUnsubscribe(topic string)
}

type Hub struct {
	clients    map[*Client]bool
	topics     map[string]map[*Client]bool // topic -> set of clients
	register   chan *Client
	unregister chan *Client
	subscribe  chan subscription
	publish    chan publication
	handler    SubscriptionHandler
	logger     *slog.Logger
	mu         sync.RWMutex
}

type subscription struct {
	client *Client
	topic  string
	add    bool // true = subscribe, false = unsubscribe
}

type publication struct {
	topic string
	data  []byte
}

func New(logger *slog.Logger) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		topics:     make(map[string]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		subscribe:  make(chan subscription),
		publish:    make(chan publication, 256),
		logger:     logger.With("component", "hub"),
	}
}

func (h *Hub) SetSubscriptionHandler(handler SubscriptionHandler) {
	h.handler = handler
}

// Run starts the hub's event loop. Must be called in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			h.logger.Info("client registered", "client", client.ID(), "total", len(h.clients))

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				// Unsubscribe from all topics
				for topic := range client.topics {
					h.removeSub(client, topic)
				}
				delete(h.clients, client)
				close(client.send)
				h.logger.Info("client unregistered", "client", client.ID(), "total", len(h.clients))
			}

		case sub := <-h.subscribe:
			if sub.add {
				h.addSub(sub.client, sub.topic)
			} else {
				h.removeSub(sub.client, sub.topic)
			}

		case pub := <-h.publish:
			if subscribers, ok := h.topics[pub.topic]; ok {
				for client := range subscribers {
					client.Send(pub.data)
				}
			}
		}
	}
}

func (h *Hub) addSub(client *Client, topic string) {
	if _, ok := h.topics[topic]; !ok {
		h.topics[topic] = make(map[*Client]bool)
	}

	wasEmpty := len(h.topics[topic]) == 0
	h.topics[topic][client] = true
	client.AddTopic(topic)

	h.logger.Debug("subscribed", "client", client.ID(), "topic", topic, "subscribers", len(h.topics[topic]))

	if wasEmpty && h.handler != nil {
		h.handler.OnFirstSubscribe(topic)
	}
}

func (h *Hub) removeSub(client *Client, topic string) {
	if subscribers, ok := h.topics[topic]; ok {
		delete(subscribers, client)
		client.RemoveTopic(topic)

		h.logger.Debug("unsubscribed", "client", client.ID(), "topic", topic, "subscribers", len(subscribers))

		if len(subscribers) == 0 {
			delete(h.topics, topic)
			if h.handler != nil {
				h.handler.OnLastUnsubscribe(topic)
			}
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}

func (h *Hub) Subscribe(client *Client, topic string) {
	h.subscribe <- subscription{client: client, topic: topic, add: true}
}

func (h *Hub) Unsubscribe(client *Client, topic string) {
	h.subscribe <- subscription{client: client, topic: topic, add: false}
}

// Publish sends a raw message to all subscribers of a topic.
func (h *Hub) Publish(topic string, data []byte) {
	h.publish <- publication{topic: topic, data: data}
}

// PublishHTML sends an HTML fragment to all subscribers of a topic.
// HTMX will swap elements with matching IDs via hx-swap-oob.
func (h *Hub) PublishHTML(topic string, html string) {
	msg := OutboundMessage{
		Type:  MsgHTML,
		Topic: topic,
		HTML:  html,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		h.logger.Error("failed to marshal html message", "error", err)
		return
	}
	h.Publish(topic, data)
}

// TopicSubscriberCount returns the number of subscribers for a topic.
func (h *Hub) TopicSubscriberCount(topic string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.topics[topic])
}

// ClientCount returns the total number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
