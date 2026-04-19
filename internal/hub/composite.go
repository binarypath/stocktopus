package hub

import "strings"

// CompositeHandler routes subscription events to the appropriate handler
// based on topic prefix. This allows multiple pollers (quotes, news, etc.)
// to share a single hub.
type CompositeHandler struct {
	handlers []prefixHandler
}

type prefixHandler struct {
	prefix  string
	handler SubscriptionHandler
}

func NewCompositeHandler() *CompositeHandler {
	return &CompositeHandler{}
}

// Register adds a handler for topics matching the given prefix.
func (c *CompositeHandler) Register(prefix string, h SubscriptionHandler) {
	c.handlers = append(c.handlers, prefixHandler{prefix: prefix, handler: h})
}

func (c *CompositeHandler) OnFirstSubscribe(topic string) {
	for _, ph := range c.handlers {
		if strings.HasPrefix(topic, ph.prefix) {
			ph.handler.OnFirstSubscribe(topic)
			return
		}
	}
}

func (c *CompositeHandler) OnLastUnsubscribe(topic string) {
	for _, ph := range c.handlers {
		if strings.HasPrefix(topic, ph.prefix) {
			ph.handler.OnLastUnsubscribe(topic)
			return
		}
	}
}
