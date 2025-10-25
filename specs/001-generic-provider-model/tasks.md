# Tasks: Generic Provider Model for Market Data

**Input**: Design documents from `/home/pete/git/stocktopus/specs/001-generic-provider-model/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the specification. Tasks focus on implementation with contract tests following Constitution Principle III (Test-First).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `- [ ] [ID] [P?] [Story?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and provider abstraction framework

- [x] T001 Create provider directory structure: internal/provider/, internal/provider/alphavantage/, internal/provider/polygon/, internal/provider/financialmodelingprep/
- [x] T002 [P] Create test directory structure: tests/contract/, tests/integration/, tests/unit/provider/
- [x] T003 [P] Update config.yaml with provider configuration section per contracts/provider-config.md
- [x] T004 [P] Setup structured logging configuration for provider observability

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core provider abstraction that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Define StockProvider interface in internal/provider/provider.go with GetQuote, GetQuotes, Name, HealthCheck methods per contracts/stock-provider-interface.md
- [x] T006 [P] Define standardized Quote struct in internal/model/stock.go with Symbol, Price, Volume, Timestamp, Change, ChangePercent fields
- [x] T007 [P] Define Snapshot struct in internal/model/stock.go extending Quote with DayOpen, DayHigh, DayLow, PrevClose fields
- [x] T008 [P] Define ProviderError struct in internal/provider/errors.go with Provider, Operation, StatusCode, Err, Retryable fields
- [x] T009 [P] Create normalization utilities in internal/provider/normalize.go: ParsePrice, ParseVolume, ParsePercentage, ParseTimestamp per contracts/provider-responses.md
- [x] T010 [P] Create provider registry in internal/provider/registry.go with Register and Create factory functions
- [x] T011 [P] Define RateLimiter interface in internal/provider/ratelimit.go with Wait and Allow methods
- [x] T012 Implement token bucket rate limiter in internal/provider/ratelimit.go supporting maxRequests and window configuration
- [x] T013 [P] Create retry middleware wrapper in internal/provider/retry.go implementing exponential backoff with jitter
- [x] T014 [P] Create circuit breaker middleware in internal/provider/circuitbreaker.go with Open/Closed/Half-Open states
- [x] T015 [P] Create observable provider wrapper in internal/provider/observability.go for structured logging and metrics
- [x] T016 Create provider builder in internal/provider/builder.go for composing middleware (rate limit + retry + circuit breaker + observability)
- [x] T017 [P] Write contract test suite in tests/contract/provider_test.go: TestProviderContract covering GetQuote, GetQuotes, Name, HealthCheck per contracts/stock-provider-interface.md
- [x] T018 [P] Create mock provider in tests/contract/mock_provider.go for engine testing

**Checkpoint**: Foundation ready - provider implementations can now be added in parallel

---

## Phase 3: User Story 1 - Switch Between Data Providers (Priority: P1) 🎯 MVP

**Goal**: Enable seamless provider switching without changing screening logic or configuration format

**Independent Test**: Configure with Alpha Vantage, run screen, switch to Polygon, run same screen, verify identical behavior

### Implementation for User Story 1

- [ ] T019 [P] [US1] Implement Alpha Vantage provider in internal/provider/alphavantage/alphavantage.go with GetQuote method normalizing response per contracts/provider-responses.md
- [ ] T020 [P] [US1] Implement Alpha Vantage GetQuotes method in internal/provider/alphavantage/alphavantage.go with sequential fan-out (no batch API)
- [ ] T021 [P] [US1] Implement Alpha Vantage Name method returning "alphavantage"
- [ ] T022 [P] [US1] Implement Alpha Vantage HealthCheck method validating API key at startup
- [ ] T023 [P] [US1] Register Alpha Vantage provider in init() function with provider registry
- [ ] T024 [P] [US1] Refactor existing Polygon provider in internal/provider/polygon/polygon.go to implement StockProvider interface
- [ ] T025 [P] [US1] Implement Polygon GetQuote method normalizing Snapshot API response per contracts/provider-responses.md
- [ ] T026 [P] [US1] Implement Polygon GetQuotes method using batch ticker endpoint
- [ ] T027 [P] [US1] Implement Polygon Name method returning "polygon"
- [ ] T028 [P] [US1] Implement Polygon HealthCheck method validating API key at startup
- [ ] T029 [P] [US1] Register Polygon provider in init() function with provider registry
- [ ] T030 [P] [US1] Implement FMP provider in internal/provider/financialmodelingprep/fmp.go with GetQuote method normalizing response per contracts/provider-responses.md
- [ ] T031 [P] [US1] Implement FMP GetQuotes method using comma-separated batch API
- [ ] T032 [P] [US1] Implement FMP Name method returning "fmp"
- [ ] T033 [P] [US1] Implement FMP HealthCheck method validating API key at startup
- [ ] T034 [P] [US1] Register FMP provider in init() function with provider registry
- [ ] T035 [US1] Update config loader in internal/config/config.go to parse provider configuration from YAML per contracts/provider-config.md
- [ ] T036 [US1] Implement environment variable substitution for provider.apiKey in config loader supporting ${VAR_NAME} syntax
- [ ] T037 [US1] Add provider configuration validation in internal/config/config.go checking required fields and valid provider names
- [ ] T038 [US1] Update Engine in internal/engine/engine.go to accept StockProvider interface instead of concrete Polygon implementation
- [ ] T039 [US1] Implement provider initialization in main.go: load config, create provider via registry, build with middleware, call HealthCheck with 10s timeout
- [ ] T040 [US1] Log active provider name at startup using structured logging per Constitution Principle V
- [ ] T041 [P] [US1] Write integration test in tests/integration/provider_switch_test.go verifying provider switching produces consistent results
- [ ] T042 [P] [US1] Write unit tests for Alpha Vantage provider in tests/unit/provider/alphavantage_test.go using httptest mock server
- [ ] T043 [P] [US1] Write unit tests for Polygon provider in tests/unit/provider/polygon_test.go using httptest mock server
- [ ] T044 [P] [US1] Write unit tests for FMP provider in tests/unit/provider/fmp_test.go using httptest mock server
- [ ] T045 [US1] Verify all three providers pass contract test suite in tests/contract/provider_test.go

**Checkpoint**: At this point, User Story 1 should be fully functional - users can switch providers by changing config.yaml and restarting

---

## Phase 4: User Story 2 - Access Standardized Market Data Metrics (Priority: P2)

**Goal**: Provide consistent market data metrics across providers for portable screening scripts

**Independent Test**: Write screening script using standardized metrics (current_price, daily_volume, percent_change), verify works with two different providers

### Implementation for User Story 2

- [ ] T046 [P] [US2] Create metric documentation in internal/provider/metrics.go listing standardized metric names and types
- [ ] T047 [P] [US2] Implement Quote validation in internal/provider/normalize.go: ValidateQuote checking Price > 0, Volume >= 0, Symbol non-empty, Timestamp not future
- [ ] T048 [US2] Update VM integration in internal/vm/vm.go to expose Quote fields as standardized metric names (price, volume, change_percent, etc.)
- [ ] T049 [US2] Create Lua API documentation for standardized metrics in docs/metrics.md with field names, types, and examples
- [ ] T050 [US2] Update Engine.FetchStocks in internal/engine/engine.go to validate all Quote responses before passing to VM
- [ ] T051 [P] [US2] Write integration test in tests/integration/metrics_normalization_test.go verifying metric consistency across providers (price in dollars, volume in int64, percentage as decimal)
- [ ] T052 [P] [US2] Update quickstart.md example screening script to demonstrate standardized metric usage

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - users can write provider-agnostic screening scripts

---

## Phase 5: User Story 3 - Configure Provider-Specific Settings (Priority: P3)

**Goal**: Allow advanced configuration of provider settings (API keys, rate limits, timeouts) through configuration interface

**Independent Test**: Create provider configs for different tiers (free-tier amateur, professional real-time, quant historical), verify each authenticates and respects configured limits

### Implementation for User Story 3

- [ ] T053 [P] [US3] Implement rate limit configuration parsing in internal/config/config.go for rateLimit.maxRequests, rateLimit.window, rateLimit.strategy
- [ ] T054 [P] [US3] Implement retry configuration parsing in internal/config/config.go for retry.maxAttempts, retry.initialBackoff, retry.maxBackoff, retry.multiplier, retry.jitter
- [ ] T055 [P] [US3] Implement circuit breaker configuration parsing in internal/config/config.go for circuitBreaker.maxFailures, circuitBreaker.resetTimeout
- [ ] T056 [US3] Update provider builder in internal/provider/builder.go to apply configuration to middleware (rate limiter, retry, circuit breaker)
- [ ] T057 [US3] Implement provider-specific options parsing in internal/config/config.go for provider.options map
- [ ] T058 [US3] Update Alpha Vantage provider to support options.datatype configuration
- [ ] T059 [US3] Update Polygon provider to support options.adjusted configuration
- [ ] T060 [US3] Update FMP provider to support options.exchange configuration
- [ ] T061 [US3] Implement proactive refresh rate adaptation in internal/engine/engine.go: compute refresh interval from provider capabilities (rate limit + data latency)
- [ ] T062 [P] [US3] Create provider metadata in internal/model/provider_meta.go with Name, Tier, RateLimit, DataLatency, BatchSupport fields
- [ ] T063 [P] [US3] Implement GetMetadata method on each provider returning ProviderMeta
- [ ] T064 [P] [US3] Write unit tests for config parsing in tests/unit/config_test.go verifying validation and defaults
- [ ] T065 [P] [US3] Write integration test in tests/integration/ratelimit_test.go verifying rate limiting prevents quota exhaustion
- [ ] T066 [P] [US3] Create example configurations in config.yaml for each provider tier per contracts/provider-config.md

**Checkpoint**: All core user stories (US1, US2, US3) should now be independently functional

---

## Phase 6: User Story 4 - Discover Available Providers and Capabilities (Priority: P4)

**Goal**: Display supported providers with characteristics (cost tier, latency, coverage) for informed decision-making

**Independent Test**: Run provider discovery command, verify list shows all providers with accurate capability information

### Implementation for User Story 4

- [ ] T067 [P] [US4] Create provider discovery command in cmd/providers.go listing registered providers
- [ ] T068 [US4] Implement provider list display in TUI showing Name, Tier, RateLimit, DataLatency per provider
- [ ] T069 [US4] Add provider recommendations to discovery output: "Best for beginners: Alpha Vantage free tier"
- [ ] T070 [P] [US4] Update quickstart.md with provider comparison table and selection guidance
- [ ] T071 [P] [US4] Write integration test verifying provider discovery command returns all registered providers

**Checkpoint**: All user stories (US1-US4) complete - feature ready for polish phase

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, observability, and documentation improvements across all user stories

- [ ] T072 [P] Create TUI error panel component in internal/tui/error_panel.go displaying provider errors, warnings, status per spec.md FR-013
- [ ] T073 Integrate error panel into TUI view in internal/tui/view.go subscribing to engine error channel
- [ ] T074 Update Engine in internal/engine/engine.go to publish provider errors to TUI error channel
- [ ] T075 Implement error display format in internal/tui/error_panel.go: [LEVEL] provider: message with timestamp and retry count
- [ ] T076 [P] Implement mid-session provider switching in internal/engine/engine.go with data inconsistency warning per spec.md clarification #5
- [ ] T077 [P] Add TUI warning dialog for provider switching showing "Switching providers may cause data inconsistency"
- [ ] T078 [P] Implement API version detection in each provider: detect format changes, warn user, attempt backward compatibility
- [ ] T079 [P] Add metrics collection for provider operations: request count, error count, latency per provider/operation
- [ ] T080 [P] Write structured logs for all provider API calls with provider, operation, symbol, duration, status
- [ ] T081 [P] Update quickstart.md with troubleshooting section for common errors (invalid API key, rate limit, symbol not found, timeouts)
- [ ] T082 [P] Create provider comparison guide in docs/providers.md with feature matrix and use case recommendations
- [ ] T083 [P] Verify quickstart.md walkthrough: setup each provider, run example screen, validate output
- [ ] T084 [P] Run Constitution compliance check: verify all 7 principles satisfied (interface-first, concurrent, test-first, integration tests, observability, versioning, simplicity)
- [ ] T085 Code cleanup: remove debug logging, unused imports, ensure consistent error messages
- [ ] T086 Final integration test: switch between all three providers mid-session, verify error handling, validate metrics
- [ ] T087 Performance validation: verify API calls < 2s latency, TUI updates < 100ms, concurrent fetching for 50+ symbols per plan.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3 → P4)
- **Polish (Phase 7)**: Depends on core user stories (US1-US3) being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on User Story 1 (needs provider implementations to normalize)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories (can run parallel with US1)
- **User Story 4 (P4)**: Depends on User Story 1 (needs provider implementations to discover)

### Within Each User Story

- Provider implementations (Alpha Vantage, Polygon, FMP) can run in parallel
- Tests can run in parallel after implementation
- Config parsing before provider initialization
- Engine integration after provider implementations complete

### Parallel Opportunities

- **Setup Phase**: T002, T003, T004 can run in parallel
- **Foundational Phase**: T006, T007, T008, T009, T010, T011, T013, T014, T015, T017, T018 can run in parallel (after T005 interface definition)
- **User Story 1**: T019-T034 (all provider implementations) can run in parallel, T042-T044 (tests) can run in parallel
- **User Story 2**: T046, T047, T051, T052 can run in parallel
- **User Story 3**: T053-T055, T062-T066 can run in parallel
- **User Story 4**: T067, T070, T071 can run in parallel
- **Polish**: T072, T076-T083 can run in parallel

---

## Parallel Example: User Story 1 (Provider Implementations)

```bash
# Launch all three provider implementations in parallel:
Task: "Implement Alpha Vantage provider (T019-T023)"
Task: "Refactor Polygon provider (T024-T029)"
Task: "Implement FMP provider (T030-T034)"

# After implementations, launch all unit tests in parallel:
Task: "Write Alpha Vantage tests (T042)"
Task: "Write Polygon tests (T043)"
Task: "Write FMP tests (T044)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test provider switching with Alpha Vantage, Polygon, FMP
5. Deploy/demo basic provider switching capability

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → Test provider switching → Deploy/Demo (MVP!)
3. Add User Story 2 → Test metric standardization → Deploy/Demo
4. Add User Story 3 → Test advanced configuration → Deploy/Demo
5. Add User Story 4 → Test provider discovery → Deploy/Demo
6. Polish Phase → Production ready

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: Alpha Vantage provider (T019-T023, T042)
   - Developer B: Polygon provider (T024-T029, T043)
   - Developer C: FMP provider (T030-T034, T044)
   - Developer D: Config/Engine integration (T035-T040)
3. Merge all providers and proceed to User Story 2

---

## Summary

**Total Tasks**: 87 tasks

**Tasks per User Story**:
- Setup: 4 tasks
- Foundational: 14 tasks (BLOCKING)
- User Story 1 (P1): 27 tasks - Provider switching
- User Story 2 (P2): 7 tasks - Standardized metrics
- User Story 3 (P3): 14 tasks - Advanced configuration
- User Story 4 (P4): 5 tasks - Provider discovery
- Polish: 16 tasks

**Parallel Opportunities**: 45 tasks marked [P] can run in parallel within their phase

**Independent Test Criteria**:
- US1: Switch providers via config, verify same screening results
- US2: Write provider-agnostic script, verify works with 2+ providers
- US3: Configure different tiers, verify auth and rate limiting
- US4: Run discovery command, verify accurate provider information

**Suggested MVP Scope**: User Story 1 only (provider switching) - delivers core value proposition

---

## Notes

- [P] tasks = different files, no dependencies within phase
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Constitution Principle III enforced: Contract tests written before implementations
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Focus on simplicity per Constitution Principle VII: Single active provider, simple rate limiting, US markets only
