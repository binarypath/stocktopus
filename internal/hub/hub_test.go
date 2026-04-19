package hub

import (
	"encoding/json"
	"log/slog"
	"testing"
	"time"
)

type mockSubHandler struct {
	firstSubs []string
	lastUnsubs []string
}

func (m *mockSubHandler) OnFirstSubscribe(topic string)  { m.firstSubs = append(m.firstSubs, topic) }
func (m *mockSubHandler) OnLastUnsubscribe(topic string) { m.lastUnsubs = append(m.lastUnsubs, topic) }

func newTestHub() *Hub {
	h := New(slog.Default())
	go h.Run()
	return h
}

func newTestClient(h *Hub, id string) *Client {
	return &Client{
		id:     id,
		hub:    h,
		send:   make(chan []byte, 64),
		topics: make(map[string]bool),
		logger: slog.Default(),
	}
}

func TestRegisterUnregister(t *testing.T) {
	h := newTestHub()
	c := newTestClient(h, "test-1")

	h.Register(c)
	time.Sleep(20 * time.Millisecond)

	h.Unregister(c)
	time.Sleep(20 * time.Millisecond)

	// send channel should be closed after unregister
	_, ok := <-c.send
	if ok {
		t.Error("expected send channel to be closed after unregister")
	}
}

func TestSubscribePublish(t *testing.T) {
	h := newTestHub()
	c1 := newTestClient(h, "c1")
	c2 := newTestClient(h, "c2")

	h.Register(c1)
	h.Register(c2)
	time.Sleep(20 * time.Millisecond)

	h.Subscribe(c1, "quote:AAPL")
	h.Subscribe(c2, "quote:AAPL")
	time.Sleep(20 * time.Millisecond)

	msg := OutboundMessage{Type: MsgQuoteUpdate, Topic: "quote:AAPL"}
	data, _ := json.Marshal(msg)
	h.Publish("quote:AAPL", data)
	time.Sleep(20 * time.Millisecond)

	// Both clients should receive the message
	select {
	case got := <-c1.send:
		var m OutboundMessage
		json.Unmarshal(got, &m)
		if m.Topic != "quote:AAPL" {
			t.Errorf("c1: expected topic quote:AAPL, got %s", m.Topic)
		}
	default:
		t.Error("c1 did not receive message")
	}

	select {
	case got := <-c2.send:
		var m OutboundMessage
		json.Unmarshal(got, &m)
		if m.Topic != "quote:AAPL" {
			t.Errorf("c2: expected topic quote:AAPL, got %s", m.Topic)
		}
	default:
		t.Error("c2 did not receive message")
	}
}

func TestUnsubscribeStopsMessages(t *testing.T) {
	h := newTestHub()
	c := newTestClient(h, "c1")

	h.Register(c)
	time.Sleep(20 * time.Millisecond)

	h.Subscribe(c, "quote:AAPL")
	time.Sleep(20 * time.Millisecond)

	h.Unsubscribe(c, "quote:AAPL")
	time.Sleep(20 * time.Millisecond)

	msg := OutboundMessage{Type: MsgQuoteUpdate, Topic: "quote:AAPL"}
	data, _ := json.Marshal(msg)
	h.Publish("quote:AAPL", data)
	time.Sleep(20 * time.Millisecond)

	select {
	case <-c.send:
		t.Error("should not receive message after unsubscribe")
	default:
		// expected
	}
}

func TestSubscriptionHandler(t *testing.T) {
	h := newTestHub()
	handler := &mockSubHandler{}
	h.SetSubscriptionHandler(handler)

	c1 := newTestClient(h, "c1")
	c2 := newTestClient(h, "c2")

	h.Register(c1)
	h.Register(c2)
	time.Sleep(20 * time.Millisecond)

	// First subscribe should trigger OnFirstSubscribe
	h.Subscribe(c1, "quote:AAPL")
	time.Sleep(20 * time.Millisecond)

	if len(handler.firstSubs) != 1 || handler.firstSubs[0] != "quote:AAPL" {
		t.Errorf("expected OnFirstSubscribe for quote:AAPL, got %v", handler.firstSubs)
	}

	// Second subscribe should NOT trigger again
	h.Subscribe(c2, "quote:AAPL")
	time.Sleep(20 * time.Millisecond)

	if len(handler.firstSubs) != 1 {
		t.Errorf("OnFirstSubscribe called again, got %v", handler.firstSubs)
	}

	// Unsubscribe one -- should NOT trigger OnLastUnsubscribe
	h.Unsubscribe(c1, "quote:AAPL")
	time.Sleep(20 * time.Millisecond)

	if len(handler.lastUnsubs) != 0 {
		t.Errorf("OnLastUnsubscribe called too early, got %v", handler.lastUnsubs)
	}

	// Unsubscribe last -- SHOULD trigger OnLastUnsubscribe
	h.Unsubscribe(c2, "quote:AAPL")
	time.Sleep(20 * time.Millisecond)

	if len(handler.lastUnsubs) != 1 || handler.lastUnsubs[0] != "quote:AAPL" {
		t.Errorf("expected OnLastUnsubscribe for quote:AAPL, got %v", handler.lastUnsubs)
	}
}

func TestUnregisterCleansUpSubscriptions(t *testing.T) {
	h := newTestHub()
	handler := &mockSubHandler{}
	h.SetSubscriptionHandler(handler)

	c := newTestClient(h, "c1")
	h.Register(c)
	time.Sleep(20 * time.Millisecond)

	h.Subscribe(c, "quote:AAPL")
	h.Subscribe(c, "quote:MSFT")
	time.Sleep(20 * time.Millisecond)

	// Unregister should clean up all subscriptions
	h.Unregister(c)
	time.Sleep(20 * time.Millisecond)

	if len(handler.lastUnsubs) != 2 {
		t.Errorf("expected 2 OnLastUnsubscribe calls, got %d: %v", len(handler.lastUnsubs), handler.lastUnsubs)
	}
}
