package config

import (
	"gopkg.in/yaml.v3"
	"os"
)

// Config holds all configuration for the application.
type Config struct {
	APIKey         string   `yaml:"apiKey"`
	RefreshSeconds int      `yaml:"refreshSeconds"`
	Tickers        []string `yaml:"tickers"`
}

// Load reads configuration from a file and unmarshals it.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
