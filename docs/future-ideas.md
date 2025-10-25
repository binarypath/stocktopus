# Future Feature Ideas

This document tracks potential features and enhancements for future consideration.

## Authentication & Security

### OAuth Authentication
- **Description**: Add OAuth2 support for provider authentication instead of just API keys
- **Benefit**: More secure authentication flow, token refresh handling, no hardcoded API keys
- **Providers**: Could be useful for providers that support OAuth (e.g., some enterprise APIs)
- **Priority**: TBD
- **Dependencies**: None

---

## Performance & Concurrency

### Worker Pool for Parallel Quote Fetching
- **Description**: Implement bounded concurrency for GetQuotes() to fetch multiple symbols in parallel
- **Benefit**: Significantly faster batch quote fetching (10x-100x speedup for large symbol lists)
- **Implementation**: Use worker pool pattern with semaphore to limit concurrent requests (e.g., 10 workers)
- **Considerations**: Must respect provider rate limits, handle partial failures gracefully
- **Priority**: Medium
- **Dependencies**: None
- **Estimated Effort**: 1-2 days

---

## Ideas Backlog

*Add new ideas below this line*

