//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"testing"
)

// /api/watchlists/* CRUD + the FMP-search-backed validation that landed in
// PR #58 (rejects raw "MICROSOFT" because the exact-symbol check finds MSFT
// instead). Uses the in-memory store from TestMain.

func TestSmoke_WatchlistCRUD(t *testing.T) {
	// Create
	resp := postJSON(t, "/api/watchlists", `{"name":"smoke watchlist"}`)
	assertStatus(t, resp, 200)
	var wl struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wl); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	resp.Body.Close()
	if wl.ID == 0 {
		t.Fatal("expected non-zero watchlist id")
	}

	// List
	list := get(t, "/api/watchlists")
	assertStatus(t, list, 200)
	var lists []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	json.NewDecoder(list.Body).Decode(&lists)
	list.Body.Close()
	found := false
	for _, l := range lists {
		if l.ID == wl.ID && l.Name == "smoke watchlist" {
			found = true
			break
		}
	}
	if !found {
		t.Error("created watchlist not found in /api/watchlists list")
	}

	// Add a valid symbol — FMP search must find an exact AAPL match.
	addOK := postJSON(t, fmt.Sprintf("/api/watchlists/%d/symbols", wl.ID), `{"symbol":"AAPL"}`)
	assertStatus(t, addOK, 200)
	addOK.Body.Close()

	// Remove that symbol. (The handler returns 200 + {"status":"removed"} —
	// this is asymmetric with /sketches' DELETE which returns 204, but the
	// behaviour predates these tests so locking it in here rather than
	// changing the contract.)
	rm := deleteReq(t, fmt.Sprintf("/api/watchlists/%d/symbols/AAPL", wl.ID))
	assertStatus(t, rm, 200)
	rm.Body.Close()
}

// "MICROSOFT" must NOT be added — FMP search returns MSFT (a name match,
// not an exact symbol match), so the server-side validator rejects it
// with 422. This is the regression test for PR #58.
func TestSmoke_WatchlistRejectsNonExactSymbol(t *testing.T) {
	// Create a throwaway watchlist to add into.
	resp := postJSON(t, "/api/watchlists", `{"name":"reject-test"}`)
	assertStatus(t, resp, 200)
	var wl struct {
		ID int64 `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&wl)
	resp.Body.Close()

	bad := postJSON(t, fmt.Sprintf("/api/watchlists/%d/symbols", wl.ID), `{"symbol":"MICROSOFT"}`)
	defer bad.Body.Close()
	assertStatus(t, bad, 422)
}
