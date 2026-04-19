package hub

import "encoding/json"

type MessageType string

const (
	MsgSubscribe   MessageType = "subscribe"
	MsgUnsubscribe MessageType = "unsubscribe"
	MsgQuoteUpdate MessageType = "quote_update"
	MsgSnapshot    MessageType = "snapshot"
	MsgError       MessageType = "error"
	MsgHTML        MessageType = "html"
)

// InboundMessage is what clients send to the server.
type InboundMessage struct {
	Type   MessageType `json:"type"`
	Topic  string      `json:"topic,omitempty"`
	Symbol string      `json:"symbol,omitempty"`
}

// OutboundMessage is what the server sends to clients.
type OutboundMessage struct {
	Type    MessageType     `json:"type"`
	Topic   string          `json:"topic,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	HTML    string          `json:"html,omitempty"`
	Error   string          `json:"error,omitempty"`
}
