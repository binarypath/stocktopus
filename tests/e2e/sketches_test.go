//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"testing"
)

// Round-trips the entire /api/sketches surface against the in-memory store
// configured by TestMain. No external API calls — pure DB CRUD.
func TestSmoke_SketchesCRUD(t *testing.T) {
	// Create
	resp := postJSON(t, "/api/sketches", `{"name":"crud test"}`)
	assertStatus(t, resp, 200)
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	resp.Body.Close()
	if created.ID == 0 {
		t.Fatal("expected non-zero sketch id from create")
	}
	id := created.ID

	// Get
	got := get(t, fmt.Sprintf("/api/sketches/%d", id))
	assertStatus(t, got, 200)
	var sk struct {
		ID      int64  `json:"id"`
		Name    string `json:"name"`
		Notes   string `json:"notes"`
		Metrics []any  `json:"metrics"`
	}
	if err := json.NewDecoder(got.Body).Decode(&sk); err != nil {
		t.Fatalf("decode get: %v", err)
	}
	got.Body.Close()
	if sk.Name != "crud test" {
		t.Errorf("expected name 'crud test', got %q", sk.Name)
	}

	// List — created sketch must appear
	list := get(t, "/api/sketches")
	assertStatus(t, list, 200)
	var sketches []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	json.NewDecoder(list.Body).Decode(&sketches)
	list.Body.Close()
	found := false
	for _, s := range sketches {
		if s.ID == id {
			found = true
			break
		}
	}
	if !found {
		t.Error("created sketch missing from /api/sketches list")
	}

	// Rename
	ren := patchJSON(t, fmt.Sprintf("/api/sketches/%d", id), `{"name":"renamed"}`)
	assertStatus(t, ren, 204)
	ren.Body.Close()

	// Notes
	notes := putJSON(t, fmt.Sprintf("/api/sketches/%d/notes", id), `{"notes":"hello notes"}`)
	assertStatus(t, notes, 204)
	notes.Body.Close()

	// Add metric
	addM := postJSON(t, fmt.Sprintf("/api/sketches/%d/metrics", id), `{"kind":"price","identifier":"AAPL","label":"AAPL"}`)
	assertStatus(t, addM, 200)
	var metric struct {
		ID int64 `json:"id"`
	}
	json.NewDecoder(addM.Body).Decode(&metric)
	addM.Body.Close()
	if metric.ID == 0 {
		t.Fatal("expected non-zero metric id")
	}

	// Verify rename + notes + metric land on subsequent GET
	got2 := get(t, fmt.Sprintf("/api/sketches/%d", id))
	assertStatus(t, got2, 200)
	var sk2 struct {
		Name    string `json:"name"`
		Notes   string `json:"notes"`
		Metrics []struct {
			ID         int64  `json:"id"`
			Kind       string `json:"kind"`
			Identifier string `json:"identifier"`
		} `json:"metrics"`
	}
	json.NewDecoder(got2.Body).Decode(&sk2)
	got2.Body.Close()
	if sk2.Name != "renamed" {
		t.Errorf("expected rename to stick, got %q", sk2.Name)
	}
	if sk2.Notes != "hello notes" {
		t.Errorf("expected notes to persist, got %q", sk2.Notes)
	}
	if len(sk2.Metrics) != 1 || sk2.Metrics[0].Identifier != "AAPL" || sk2.Metrics[0].Kind != "price" {
		t.Errorf("expected one AAPL price metric, got %+v", sk2.Metrics)
	}

	// Remove metric
	rmM := deleteReq(t, fmt.Sprintf("/api/sketches/%d/metrics/%d", id, metric.ID))
	assertStatus(t, rmM, 204)
	rmM.Body.Close()

	// Verify metric gone
	got3 := get(t, fmt.Sprintf("/api/sketches/%d", id))
	var sk3 struct {
		Metrics []any `json:"metrics"`
	}
	json.NewDecoder(got3.Body).Decode(&sk3)
	got3.Body.Close()
	if len(sk3.Metrics) != 0 {
		t.Errorf("expected metric removed, got %d remaining", len(sk3.Metrics))
	}

	// Delete sketch
	del := deleteReq(t, fmt.Sprintf("/api/sketches/%d", id))
	assertStatus(t, del, 204)
	del.Body.Close()

	// Verify deleted — GET returns 404
	gone := get(t, fmt.Sprintf("/api/sketches/%d", id))
	assertStatus(t, gone, 404)
	gone.Body.Close()
}
