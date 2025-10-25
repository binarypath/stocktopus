# Stocktopus Project Preferences

## Project Overview
Stocktopus is a console-based stock screening application built in Go 1.22+ that continuously scans for stocks meeting user-defined criteria using a provider-agnostic architecture, Lua-based screening logic, and a live Bubble Tea TUI.

## Technology Stack
- **Language**: Go 1.22+
- **TUI Framework**: Bubble Tea (github.com/charmbracelet/bubbletea)
- **Scripting Engine**: gopher-lua (github.com/yuin/gopher-lua)
- **Configuration**: YAML with environment variable substitution
- **Logging**: Go 1.21+ log/slog (structured logging)
- **HTTP Client**: go-resty/resty/v2
- **Testing**: Standard library testing package + contract testing pattern
- **CI/CD**: GitHub Actions

## Project Structure
```
/home/pete/git/stocktopus/
├── cmd/stocktopus/main.go          # Application entry point
├── internal/                        # Non-exported core code
│   ├── app/                        # Application orchestration
│   ├── config/                     # YAML configuration loader
│   ├── engine/                     # Main event loop coordinator
│   ├── logging/                    # Structured logging setup
│   ├── model/                      # Data models (Quote, Snapshot)
│   ├── provider/                   # Provider abstraction + middleware
│   │   ├── alphavantage/          # Alpha Vantage implementation
│   │   ├── polygon/               # Polygon.io implementation
│   │   └── financialmodelingprep/ # FMP implementation
│   ├── tui/                       # Bubble Tea terminal UI
│   └── vm/                        # Lua VM integration
├── tests/
│   ├── contract/                  # Provider contract tests
│   ├── integration/               # Integration tests
│   └── unit/                      # Unit tests
├── scripts/                       # Lua screening scripts
├── specs/                         # Feature specifications
├── config.yaml                    # Main configuration file
└── go.mod                         # Go module definition
```

## Development Priorities
1. **Engine First**: Prioritize completing the core event loop and state management in `internal/engine/` before other components
2. **Provider Middleware Standard Order**: Always compose in this order: RateLimit → Retry → CircuitBreaker → Observable
3. **TDD Approach**: Write tests before implementation with a mix of unit, contract, and integration tests
4. **Compile Check**: Always verify that any new or modified files compile successfully before proceeding to the next task or file review. Run `go build ./path/to/package/...` after making changes

## Code Style Guidelines

### Go Standards
- **Formatting**: Always use `gofmt` (enforced by CI)
- **Linting**: Use `golangci-lint` with comprehensive checks for consistency and best practices
- **Module Organization**: Follow standard Go project layout with `internal/` for non-exported packages

### Error Handling (Strict)
- **Always wrap errors** with context using `fmt.Errorf` with `%w` verb
- **Never ignore errors** without an explicit comment explaining why
- **Use ProviderError pattern** for provider-specific errors with retry semantics
- **Structured error types** for different error categories (transient vs permanent)

### Interface-First Design
- **Define interfaces before implementations**, following the `StockProvider` pattern
- **Use composition over inheritance** via middleware/decorator pattern
- **Self-registering providers** via `init()` functions in provider registry

### Naming Conventions
- **Interfaces**: Noun or adjective + "-er" suffix (e.g., `StockProvider`, `Retrier`)
- **Packages**: Singular, lowercase, no underscores (e.g., `provider`, not `providers`)
- **Files**: Lowercase with underscores for test files (e.g., `provider.go`, `provider_test.go`)

## Testing Strategy

### Test-Driven Development (TDD)
1. **Write tests first** before implementing features
2. **Red-Green-Refactor** cycle: failing test → minimal implementation → refactor
3. **Test coverage target**: Aim for 80%+ coverage on core packages

### Testing Patterns
- **Table-Driven Tests**: All tests should use table-driven pattern with named test cases
  ```go
  tests := []struct {
      name     string
      input    string
      expected string
      wantErr  bool
  }{
      {name: "valid case", input: "foo", expected: "bar", wantErr: false},
      // ...
  }
  for _, tt := range tests {
      t.Run(tt.name, func(t *testing.T) {
          // test implementation
      })
  }
  ```

### Testing Hierarchy
1. **Contract Tests**: Primary approach for interface implementations (see `tests/contract/provider_test.go`)
2. **Unit Tests**: Test individual functions and methods in isolation
3. **Integration Tests**: Validate end-to-end workflows with real components

### Test File Organization
- **Unit tests**: Co-located with source files (`provider.go` → `provider_test.go`)
- **Contract tests**: In `tests/contract/` for shared test suites
- **Integration tests**: In `tests/integration/` for cross-component tests
- **Mock implementations**: In `tests/contract/` for reusable test doubles

### Running Tests
```bash
go test -v ./...                    # All tests
go test -v ./internal/provider      # Specific package
go test -v -race ./...              # With race detector
go test -v -cover ./...             # With coverage
```

## Architecture Patterns

### Provider Registry Pattern
- Providers self-register via `init()` functions
- Dynamic provider discovery without hardcoding dependencies
- Factory pattern for provider instantiation

### Middleware Composition (Builder Pattern)
- **Standard Order**: RateLimit → Retry → CircuitBreaker → Observable
- Use `ProviderBuilder` to chain decorators:
  ```go
  provider := NewProviderBuilder(baseProvider).
      WithRateLimit(limiter).
      WithRetry(retryConfig).
      WithCircuitBreaker(breakerConfig).
      WithObservability(logger).
      Build()
  ```

### Standardized Data Normalization
- **Centralized parsing**: Use functions in `provider/normalize.go`
- **Always normalize** to standardized `Quote` struct with UTC timestamps
- **Price normalization**: Always return dollars (not cents)
- **Volume normalization**: Always return int64 shares
- **Percentage normalization**: Always return decimal (1.5% = 0.015)

## Configuration Management

### YAML Structure
- Main config file: `config.yaml` at project root
- Environment variable substitution: `${VARIABLE_NAME}` syntax
- Provider-specific options in `provider.options` map

### Configuration Sections
1. **Provider**: Name, API key, base URL, timeout, options
2. **Rate Limiting**: Strategy (token_bucket), max requests, window
3. **Retry**: Max attempts, backoff settings (initial, max, multiplier, jitter)
4. **Circuit Breaker**: Max failures, reset timeout
5. **Application**: Refresh interval, ticker list

### Environment Variables
- `STOCK_API_KEY`: API key for market data provider
- `LOG_LEVEL`: Logging level (debug, info, warn, error)
- `CONFIG_PATH`: Override default config.yaml path

## Logging Guidelines

### Structured Logging (slog)
- **Use slog exclusively**, no fmt.Printf or log.Print
- **Component loggers**: Create via `logging.NewLogger(componentName)`
- **Log levels**:
  - `Debug`: Detailed diagnostic information
  - `Info`: General informational messages (default)
  - `Warn`: Warning messages for recoverable issues
  - `Error`: Error messages for failures

### Logging Format
```go
logger.Info("fetching quote",
    "symbol", symbol,
    "provider", providerName,
    "attempt", attemptNum,
)
```

## External API Integration

### Supported Providers
1. **Polygon.io**: Real-time quotes with daily OHLCV (free tier: 5 calls/min)
2. **Alpha Vantage**: Global quote endpoint (free tier: 5 calls/min, 500/day)
3. **Financial Modeling Prep**: Professional-tier API v3

### Provider Implementation Checklist
- [ ] Implement `StockProvider` interface (GetQuote, GetQuotes, Name, HealthCheck)
- [ ] Normalize all responses using `provider/normalize.go` utilities
- [ ] Handle rate limiting errors gracefully
- [ ] Add contract tests in `tests/contract/`
- [ ] Register provider in `init()` function
- [ ] Document API endpoints and rate limits

## Git Workflow

### Branch Strategy
- `master`: Main development branch (protected)
- Feature branches: `feature/descriptive-name`
- Bug fixes: `fix/descriptive-name`

### Commit Messages
- Use conventional commits format:
  - `feat:` New feature
  - `fix:` Bug fix
  - `docs:` Documentation changes
  - `test:` Test additions/changes
  - `refactor:` Code refactoring
  - `chore:` Build/tooling changes

### CI/CD Pipeline
- **GitHub Actions**: `.github/workflows/go.yml`
- **Triggers**: Push to master, PRs to master
- **Steps**: Build → Test → (Future: Deploy)
- **Required checks**: All tests must pass before merge

## Known TODOs & Gaps

### High Priority (Implement Engine First)
1. Complete `internal/engine/engine.go` - main event loop and state management
2. Wire up Engine in `internal/app/app.go` initialization
3. Implement concurrent stock fetching with goroutines and channels

### Medium Priority
4. Complete `internal/tui/view.go` - Bubble Tea UI integration
5. Complete `internal/vm/vm.go` - gopher-lua VM initialization
6. Fix broken imports in `internal/model/view.go`

### Low Priority
7. Migrate all code to use `Quote`/`Snapshot` instead of legacy `Stock` struct
8. Remove deprecated `MarketDataProvider` interface
9. Add `Makefile` for common tasks (build, test, clean, run, docker)
10. Update GitHub Actions to use Go 1.22 (currently 1.21)

## Documentation Standards

### Code Documentation
- **Package comments**: Every package must have a doc comment
- **Exported symbols**: All exported functions, types, and constants must be documented
- **Examples**: Provide runnable examples for complex APIs

### Spec-Driven Development
- New features start with spec in `specs/XXX-feature-name/`
- Spec includes: `spec.md`, `plan.md`, `quickstart.md`, data models
- CLAUDE.md auto-generated from feature plans (DO NOT manually edit)

## Performance Considerations

### Concurrency
- **Use goroutines** for concurrent stock fetching
- **Bounded concurrency**: Limit concurrent requests to avoid overwhelming providers
- **Context propagation**: Always pass context.Context for cancellation support

### Rate Limiting
- **Token bucket** strategy with configurable limits per provider
- **Respect provider limits**: Free tiers typically 5 req/min
- **Backoff on 429**: Exponential backoff with jitter on rate limit errors

### Memory Management
- **Avoid unbounded buffers**: Use buffered channels with size limits
- **Clear old state**: Periodically clean up stale stock state in Engine

## Security Considerations

### API Key Management
- **Never commit API keys** to version control
- **Use environment variables** with `${VARIABLE_NAME}` substitution
- **Add .env to .gitignore** if using dotenv files

### Input Validation
- **Validate all user input**: Ticker symbols, config values
- **Sanitize external data**: Provider responses may contain unexpected formats
- **Use validator library**: go-playground/validator for struct validation

## Future Enhancements
- WebSocket support for real-time streaming quotes
- Historical data analysis and backtesting
- Portfolio tracking and alerting
- Custom indicator calculations in Lua
- Docker containerization for deployment
- Prometheus metrics export for observability

---

**Last Updated**: 2025-10-25
**Claude Code Version**: Generated from project exploration
