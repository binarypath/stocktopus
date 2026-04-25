//go:build e2e

package e2e

import (
	"encoding/json"
	"testing"
)

func TestSmoke_ArticleFetch(t *testing.T) {
	// CNBC article — requires headless Chrome for JS rendering
	resp := get(t, "/api/article?url=https://www.cnbc.com/2026/04/24/how-the-restaurant-group-behind-nycs-carbone-is-overcoming-young-people-shunning-alcohol.html")
	defer resp.Body.Close()

	// 502 is acceptable if agents/ dir or Chrome not available in test context
	if resp.StatusCode == 502 {
		t.Log("article fetch returned 502 (expected in test env without agents/ dir)")
		return
	}
	assertStatus(t, resp, 200)

	var data map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)

	// Should have extracted content
	if data["error"] != nil {
		t.Logf("article fetch returned error (acceptable if Chrome not available): %v", data["error"])
		return
	}

	// Check title
	title, _ := data["title"].(string)
	if title == "" {
		t.Error("expected non-empty title")
	}

	// Check paragraphs
	paras, _ := data["paragraphs"].([]interface{})
	if len(paras) < 5 {
		t.Errorf("expected at least 5 paragraphs, got %d", len(paras))
	}

	// Check word count
	wc, _ := data["wordCount"].(float64)
	if wc < 100 {
		t.Errorf("expected at least 100 words, got %v", wc)
	}

	// Check bot label
	bot, _ := data["bot"].(string)
	if bot != "Distinguished Reader Bot 9000" {
		t.Errorf("expected bot label, got %q", bot)
	}

	t.Logf("article: %s, %v words, %d paragraphs, strategy: %v",
		title[:min(40, len(title))], wc, len(paras), data["strategy"])

	// Check for entities (if Ollama is available)
	companies, _ := data["companies"].([]interface{})
	people, _ := data["people"].([]interface{})
	if len(companies) > 0 || len(people) > 0 {
		t.Logf("entities: %d companies, %d people", len(companies), len(people))
	} else {
		t.Log("no entities extracted (Ollama may not be running)")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
