package config

import (
	"os"
	"path/filepath"
	"testing"
)

// TestLoad creates and returns a new configuration object.
// In a real app, this would load from a file (e.g., config.yaml) or env variables.
func TestLoad(t *testing.T) {
	// create temp dir to store config file
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")

	// content of file
	configContent := `
apiKey: "test_api_key"
refreshSeconds: 30
tickers:
  - "TEST1"
  - "TEST2"
`

	if err := os.WriteFile(configPath, []byte(configContent), 0644); err != nil {

		t.Fatalf("failed to write temp file %v", err)
	}

	cfg, err := Load(configPath)

	if err != nil {
		t.Fatalf("Load() blew up")
	}

	if cfg.APIKey != "test_api_key" {
		t.Errorf("expected apiKey to be 'test_api_key', but got '%s'", cfg.APIKey)
	}

	if cfg.RefreshSeconds != 30 {
		t.Errorf("expected refreshSeconds to be 30, but got %d", cfg.RefreshSeconds)
	}

	if len(cfg.Tickers) != 2 || cfg.Tickers[0] != "TEST1" || cfg.Tickers[1] != "TEST2" {
		t.Errorf("expected tickers to be [TEST1, TEST2], but got %v", cfg.Tickers)
	}
}
