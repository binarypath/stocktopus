# Feature Specification: Generic Provider Model for Market Data

**Feature Branch**: `001-generic-provider-model`
**Created**: 2025-10-19
**Status**: Draft
**Input**: User description: "Add a generic provider model for market data providers. Do some web research to find the best providers for amateurs, professionals and quantitative analysts. It should enable easy plug and play swapping of providers, as well as a standardized list of market data metrics."

## Clarifications

### Session 2025-10-19

- Q: How should the system handle provider failures (API down, timeout)? → A: Log error + show TUI error panel + retry timeouts with exponential backoff + fail if retries exhausted (no cached data)
- Q: Does the system need to support multiple providers simultaneously (e.g., one for real-time, one for historical)? → A: Multi-provider optional - support it if simple, otherwise defer to v2
- Q: How should invalid API keys and quota exhaustion be handled? → A: Validate API key at startup (fail fast), handle quota exhaustion at runtime, AND proactively adapt refresh rates to match provider plan limits (15-min updates for basic plans, high-frequency for premium plans)
- Q: What happens when a provider deprecates an API endpoint or changes their data format? → A: Detect provider API version changes, warn user, attempt backward compatibility, fail gracefully if incompatible
- Q: How does the system behave when switching providers mid-session while screens are actively running? → A: Allow switching but warn user about potential data inconsistency from mixing provider sources
- Q: How are timezone differences handled across providers serving different exchanges? → A: Normalize all timestamps to UTC immediately; VM receives UTC only; users handle display TZ in scripts

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch Between Data Providers (Priority: P1)

As a developer or power user, I need to switch between different market data providers without changing my screening logic or configuration format, so I can choose the best provider for my budget and data needs.

**Why this priority**: This is the core value proposition of the feature. Without provider abstraction, users are locked into a single provider, limiting their flexibility and potentially forcing them to rewrite screening logic when changing providers.

**Independent Test**: Can be fully tested by configuring the system with Provider A, running a screen, then switching to Provider B and running the same screen, verifying identical behavior (matching stocks found) with different data sources.

**Acceptance Scenarios**:

1. **Given** the system is configured to use Alpha Vantage, **When** I change the configuration to use Polygon.io, **Then** the system continues to fetch market data without errors and screening logic works unchanged
2. **Given** I have a screening script that references standardized metrics (price, volume, change percentage), **When** I switch providers in the configuration, **Then** the script continues to work without modification
3. **Given** I switch from a free-tier provider to a professional-tier provider, **When** the system starts up, **Then** I see confirmation of the active provider and any provider-specific capabilities (e.g., real-time vs delayed quotes)

---

### User Story 2 - Access Standardized Market Data Metrics (Priority: P2)

As a user writing screening scripts, I need access to a consistent set of market data metrics regardless of which provider is configured, so my screening logic is portable and predictable.

**Why this priority**: Without metric standardization, users must learn each provider's unique field names and data formats. Standardization enables provider-agnostic screening scripts and reduces cognitive load.

**Independent Test**: Can be fully tested by writing a screening script that uses standardized metric names (e.g., current_price, daily_volume, percent_change), then verifying the script works correctly with at least two different configured providers.

**Acceptance Scenarios**:

1. **Given** I write a screening script using standardized metric names, **When** the system fetches data from any supported provider, **Then** all metrics are available with consistent naming and units
2. **Given** a provider returns price in cents, **When** the system normalizes the data, **Then** the standardized metric shows price in dollars for consistency
3. **Given** different providers use different field names for the same concept, **When** my screening script accesses a standardized metric, **Then** the system correctly maps the provider's field to the standard metric

---

### User Story 3 - Configure Provider-Specific Settings (Priority: P3)

As an advanced user, I need to configure provider-specific settings (API keys, rate limits, endpoints) through a consistent configuration interface, so I can optimize my provider usage without editing code.

**Why this priority**: Different providers require different authentication and have different capabilities. A flexible configuration system allows users to maximize the value of their chosen provider while maintaining a clean separation between configuration and application logic.

**Independent Test**: Can be fully tested by creating provider configurations for different providers (free-tier amateur, professional real-time, quant-focused historical), verifying each provider authenticates successfully and respects configured rate limits.

**Acceptance Scenarios**:

1. **Given** I have an API key for a professional provider, **When** I add it to the configuration file, **Then** the system authenticates successfully and accesses premium data features
2. **Given** my provider has rate limits of 5 requests per second, **When** I configure this limit, **Then** the system throttles requests to stay within limits and provides clear feedback if limits are exceeded
3. **Given** I want to configure provider-specific settings, **When** I update configuration values for timeout, retry behavior, or rate limits, **Then** the system respects these settings without requiring code changes

---

### User Story 4 - Discover Available Providers and Capabilities (Priority: P4)

As a user evaluating which provider to use, I need to see a list of supported providers with their key characteristics (cost tier, data latency, coverage), so I can make an informed decision.

**Why this priority**: This enhances user experience but is not critical for core functionality. Users can research providers independently, but built-in guidance reduces friction.

**Independent Test**: Can be fully tested by running a command that lists all supported providers and displays their capabilities, verifying the information matches documented provider features.

**Acceptance Scenarios**:

1. **Given** I run a provider discovery command, **When** the system responds, **Then** I see a list of supported providers categorized by user type (amateur, professional, quantitative)
2. **Given** I want to understand a provider's limitations, **When** I view provider details, **Then** I see key attributes like cost tier, request limits, real-time vs delayed data, and supported exchanges
3. **Given** I am comparing providers, **When** I review the provider list, **Then** I see recommendations for common use cases (e.g., "Best for beginners: Alpha Vantage free tier")

---

### Edge Cases

- **Provider API unreachable or returns errors**: System logs error, displays in TUI error panel, retries timeouts with exponential backoff, and fails fetch if retries exhausted (no stale data used)
- **Providers with different update frequencies**: System adapts refresh rate to provider plan capabilities (15-minute intervals for basic plans, high-frequency for premium) to prevent rate limit violations
- **Invalid API key configuration**: System validates credentials at startup and fails immediately with clear error message
- **API quota exhaustion**: Proactive rate limiting prevents quota exhaustion; if unexpectedly exceeded, display error in TUI panel
- **Provider API deprecation or format changes**: System detects API version changes, warns user through TUI, attempts backward compatibility with previous versions, fails gracefully with clear messages if incompatible
- **Switching providers mid-session**: System allows provider switching while screens are running but displays clear warning about potential data inconsistency from mixing data sources
- **Timezone differences across providers**: All timestamps are immediately normalized to UTC upon ingestion from any provider, and the Lua VM always receives UTC timestamps; users handle display timezone conversion in their own scripts if needed

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support pluggable provider implementations where adding a new provider requires only implementing a defined interface
- **FR-002**: System MUST provide at least three initial provider implementations representing different user tiers: amateur (free or low-cost with basic features), professional (paid with real-time data), and quantitative (comprehensive historical data and analytics)
- **FR-003**: System MUST define a standardized set of market data metrics that all providers must map to, including at minimum: current price, previous close, daily high/low, volume, percent change, timestamp
- **FR-004**: System MUST allow users to configure their active provider through a configuration file without code changes
- **FR-005**: System MUST normalize data from different providers to consistent units (e.g., dollars not cents, volumes in shares, percentages as decimals, timestamps in UTC)
- **FR-006**: System MUST validate provider authentication (API keys, tokens) at startup and fail immediately with clear error message if credentials are invalid
- **FR-007**: System MUST handle provider-specific authentication (API keys, tokens) through secure configuration
- **FR-008**: System MUST proactively adapt the screening refresh rate to match the provider's plan capabilities (e.g., 15-minute intervals for basic plans, high-frequency updates for premium plans) to prevent rate limit violations
- **FR-009**: System MUST provide clear error messages when provider authentication fails or API quotas are unexpectedly exceeded
- **FR-010**: System MUST maintain existing screening script compatibility - user-defined screening logic should work unchanged when switching providers
- **FR-011**: System MUST log which provider is active when the system starts up
- **FR-012**: System MUST handle provider failures by: (a) logging all errors to system logs, (b) displaying real-time error status in a TUI error panel/component, (c) retrying timeout failures using exponential backoff strategy, (d) failing the data fetch if all retries are exhausted without using stale/cached data
- **FR-013**: System MUST provide a TUI error panel/component that displays provider errors, warnings, and status messages in real-time to users
- **FR-014**: System MUST detect when a provider's API version or data format has changed, warn the user through the TUI, attempt to maintain backward compatibility with previous API versions, and fail gracefully with clear error messages if the changes are incompatible
- **FR-015**: System MUST allow users to switch providers mid-session while screens are running, but display a clear warning about potential data inconsistency from mixing data sources from different providers
- **FR-016**: System MUST document the standardized metric names and their meanings for script authors

### Key Entities

- **Provider**: Represents a market data source with attributes including name, tier (amateur/professional/quantitative), authentication requirements, rate limits (requests per second/minute), refresh interval (how often data updates are available), data latency (real-time/delayed), supported exchanges
- **Market Data Metric**: A standardized data point (e.g., current_price, daily_volume) with consistent naming, type, and units across all providers; timestamps are always in UTC timezone
- **Provider Configuration**: User-defined settings for a specific provider including API credentials, endpoint URLs, rate limits, and feature flags
- **Provider Capability**: A feature or characteristic of a provider such as real-time data access, historical data range, supported asset types, or technical indicators

### Assumptions

- All supported market data providers offer programmatic access to their data through well-documented interfaces
- All providers can deliver at minimum: current price, previous close, volume, and timestamp for US equities
- API credentials will be stored securely outside of the application code, following industry-standard security practices
- The initial implementation will focus on US equity markets; international exchanges may have different data availability
- Rate limiting will be implemented as simple request throttling; sophisticated quota management (daily limits, tiered pricing) is out of scope for initial release
- Mid-session provider switching is supported but users are warned about data inconsistency when mixing provider sources
- Simultaneous multi-provider support (e.g., one provider for real-time, another for historical data) is optional for initial release - implement if straightforward, otherwise defer to future version

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can switch between at least three different market data providers by changing a single configuration value and restarting the application
- **SC-002**: Existing screening scripts continue to work without modification when switching between supported providers (100% compatibility for standardized metrics)
- **SC-003**: New provider implementations can be added with minimal effort - adding a new provider takes less than one day of development work
- **SC-004**: System provides clear feedback within 5 seconds when a provider is misconfigured, unreachable, or over quota
- **SC-005**: All standardized metrics return values in consistent units (e.g., prices always in dollars, never cents) regardless of provider
- **SC-006**: Documentation includes a provider comparison guide that helps users select the appropriate provider for their use case within 5 minutes of reading
- **SC-007**: System logs clearly indicate which provider is active and which provider endpoints are being called, enabling users to debug integration issues independently

