//go:build e2e

package e2e

import (
	"io"
	"strings"
	"testing"
)

// vim-nav.js is the declarative navigation core. These tests confirm
// the static asset is reachable and that each migrated page renders
// the data-vim-row / data-vim-item markers the core scans for. The
// behavioural tests (j/k/h/l actually navigating) need a browser and
// are documented in the PR body.

func TestSmoke_VimNav_AssetReachable(t *testing.T) {
	resp := get(t, "/static/vim-nav.js")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	s := string(body)
	for _, want := range []string{"VimNav", "data-vim-row", "data-vim-item"} {
		if !strings.Contains(s, want) {
			t.Errorf("expected %q in vim-nav.js, got: %.300s", want, s)
		}
	}
}

// Each migrated page must emit data-vim-row on its tabs container.
// Server-side template rendering is enough to verify — the JS-emitted
// per-tab content rows are tested separately at runtime.
func TestSmoke_VimNav_TabRowMarkup(t *testing.T) {
	cases := []struct {
		path string
	}{
		{"/security/AAPL"},
		{"/crypto/BTCUSD"},
		{"/etf/SPY"},
		{"/index/^DJI"},
		{"/forex/USDGBP"},
		{"/fund/BRHYX"},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			resp := get(t, tc.path)
			defer resp.Body.Close()
			assertStatus(t, resp, 200)
			body, _ := io.ReadAll(resp.Body)
			s := string(body)
			if !strings.Contains(s, `data-vim-row`) {
				t.Errorf("expected data-vim-row in %s rendered HTML", tc.path)
			}
			if !strings.Contains(s, `data-vim-item`) {
				t.Errorf("expected data-vim-item in %s rendered HTML", tc.path)
			}
		})
	}
}

// The layout template must include vim-nav.js BEFORE terminal.js so
// the VimNav global is defined when terminal.js wires its dispatcher.
func TestSmoke_VimNav_LoadedBeforeTerminal(t *testing.T) {
	resp := get(t, "/watchlist") // any page that uses the layout
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	s := string(body)
	vimIdx := strings.Index(s, "vim-nav.js")
	termIdx := strings.Index(s, "terminal.js")
	if vimIdx < 0 {
		t.Fatal("vim-nav.js script tag missing from layout")
	}
	if termIdx < 0 {
		t.Fatal("terminal.js script tag missing from layout")
	}
	if vimIdx > termIdx {
		t.Errorf("vim-nav.js (%d) must come before terminal.js (%d) in layout", vimIdx, termIdx)
	}
}
