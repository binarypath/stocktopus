package provider

import (
	"fmt"
	"sync"
)

// ProviderFactory is a function that creates a provider instance from configuration
type ProviderFactory func(config interface{}) (StockProvider, error)

// registry holds all registered provider factories
var (
	providerRegistry = make(map[string]ProviderFactory)
	registryMu       sync.RWMutex
)

// Register adds a provider factory to the registry
// This should be called in init() functions of provider implementations
//
// Example:
//
//	func init() {
//	    provider.Register("alphavantage", func(config interface{}) (provider.StockProvider, error) {
//	        cfg := config.(AlphaVantageConfig)
//	        return NewAlphaVantageProvider(cfg), nil
//	    })
//	}
func Register(name string, factory ProviderFactory) {
	registryMu.Lock()
	defer registryMu.Unlock()

	if factory == nil {
		panic("provider: Register factory is nil")
	}
	if _, dup := providerRegistry[name]; dup {
		panic("provider: Register called twice for provider " + name)
	}
	providerRegistry[name] = factory
}

// Create instantiates a provider by name using the registered factory
// Returns error if provider name is not registered
//
// Example:
//
//	provider, err := provider.Create("alphavantage", config)
//	if err != nil {
//	    log.Fatal(err)
//	}
func Create(name string, config interface{}) (StockProvider, error) {
	registryMu.RLock()
	factory, ok := providerRegistry[name]
	registryMu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("provider %q not registered (available: %v)", name, ListProviders())
	}

	return factory(config)
}

// ListProviders returns a list of all registered provider names
func ListProviders() []string {
	registryMu.RLock()
	defer registryMu.RUnlock()

	names := make([]string, 0, len(providerRegistry))
	for name := range providerRegistry {
		names = append(names, name)
	}
	return names
}

// IsRegistered checks if a provider name is registered
func IsRegistered(name string) bool {
	registryMu.RLock()
	defer registryMu.RUnlock()

	_, ok := providerRegistry[name]
	return ok
}
