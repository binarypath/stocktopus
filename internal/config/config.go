package config

import "time"

// Config holds all configuration for the application.
type Config struct {
	RefreshInterval time.Duration
	// Future API keys would go here
	// AlphaVantageAPIKey string
}

// Load creates and returns a new configuration object.
// In a real app, this would load from a file (e.g., config.yaml) or env variables.
func Load() *Config {
	return &Config{
		RefreshInterval: 1 * time.Minute, // Default to 1 minute
	}
}
