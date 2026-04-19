package model

import "time"

// NewsItem represents a single news article from any source/category.
type NewsItem struct {
	Title    string    `json:"title"`
	Date     time.Time `json:"date"`
	Source   string    `json:"source"`
	Text     string    `json:"text"`
	URL      string    `json:"url"`
	ImageURL string    `json:"imageUrl,omitempty"`
	Symbol   string    `json:"symbol,omitempty"`
	Author   string    `json:"author,omitempty"`
}
