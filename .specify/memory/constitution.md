<!--
Sync Impact Report - Constitution v1.0.0
Generated: 2025-10-19

Version Change: [NEW] → 1.0.0
- Initial constitution ratification
- Establishes core principles for Stocktopus development

Modified Principles: N/A (initial version)
Added Sections:
  - All core principles (I-VII)
  - Development Workflow section
  - Testing Standards section
  - Governance section

Removed Sections: N/A (initial version)

Templates Requiring Updates:
  ✅ plan-template.md - Constitution Check section updated with specific checklist (lines 30-44)
  ✅ spec-template.md - Requirements structure aligns with principles
  ✅ tasks-template.md - Task organization supports test-first workflow
  ✅ checklist-template.md - Generic template, no constitution-specific changes needed
  ✅ agent-file-template.md - Generic template, no constitution-specific changes needed

Slash Command Files Reviewed:
  ✅ speckit.constitution.md - References to "CLAUDE" are instructional examples only
  ✅ speckit.plan.md - "claude" reference is in script path (implementation detail)
  ✅ All other command files - No agent-specific language detected

Follow-up TODOs: None - all templates validated and updated
-->

# Stocktopus Constitution

## Core Principles

### I. Interface-First Architecture

Every component MUST be designed around well-defined interfaces. Interfaces enable:
- **Testability**: Mock implementations for unit testing without external dependencies
- **Extensibility**: Multiple implementations (e.g., Polygon.io, Alpha Vantage, mock providers)
- **Decoupling**: Components depend on contracts, not concrete implementations

**Rationale**: The provider model demonstrates this principle—any data source can be integrated by satisfying the StockProvider interface, making the system both testable and future-proof.

### II. Concurrent & Performant by Design

The system MUST leverage Go's concurrency primitives (goroutines, channels) to maximize throughput and responsiveness:
- Stock data fetching MUST be concurrent across multiple symbols
- The UI update loop MUST remain non-blocking
- Shared state MUST use appropriate synchronization mechanisms

**Rationale**: Real-time market monitoring demands low-latency data processing. Sequential operations would degrade the user experience.

### III. Test-First Development (NON-NEGOTIABLE)

All new features and changes MUST follow TDD discipline:
1. Write tests that capture the expected behavior
2. Verify tests FAIL (red)
3. Implement minimum code to pass (green)
4. Refactor while keeping tests green

**Rationale**: Tests document intent, prevent regressions, and ensure interfaces remain stable. This is critical for a concurrent system where bugs are harder to reproduce.

### IV. Integration Testing for Critical Paths

Integration tests are REQUIRED for:
- New provider implementations (contract tests against StockProvider interface)
- Changes to provider contracts or interfaces
- Engine orchestration logic (data flow from provider → VM → TUI)
- VM scripting integration (Lua execution with real data)

**Rationale**: Unit tests verify components in isolation; integration tests verify the system works end-to-end. Both are necessary for confidence in concurrent, multi-component systems.

### V. Observability & Debuggability

All components MUST support runtime observability:
- Structured logging at appropriate levels (error, warn, info, debug)
- Clear error messages with context (what failed, why, with what inputs)
- Metrics for critical paths (fetch latency, screening throughput, UI render time)

**Rationale**: Market data systems operate in unpredictable environments (API rate limits, network failures, data anomalies). Debugging production issues requires comprehensive observability.

### VI. Semantic Versioning & Compatibility

Version numbering MUST follow semantic versioning (MAJOR.MINOR.PATCH):
- **MAJOR**: Breaking changes to public interfaces (e.g., StockProvider signature changes)
- **MINOR**: New features with backward compatibility (e.g., new provider implementation)
- **PATCH**: Bug fixes, performance improvements, internal refactoring

Breaking changes MUST include:
- Migration guide in release notes
- Deprecation warnings in prior MINOR version (when feasible)
- Updated documentation and examples

**Rationale**: Users (including future maintainers) need predictability. Clear versioning signals impact and guides upgrade decisions.

### VII. Simplicity & YAGNI (You Aren't Gonna Need It)

Start with the simplest solution that solves the immediate problem:
- Avoid premature abstraction or generalization
- Complexity MUST be justified (see plan-template.md Complexity Tracking section)
- Prefer composition over inheritance
- Prefer explicit over implicit

**Rationale**: Over-engineering increases maintenance burden and cognitive load. Build what's needed now, refactor when patterns emerge.

## Development Workflow

### Feature Development Process

1. **Specification**: Every feature starts with `/speckit.specify` to create `spec.md`
2. **Clarification**: Run `/speckit.clarify` to identify ambiguities and encode decisions
3. **Planning**: Execute `/speckit.plan` to generate design artifacts (research.md, data-model.md, contracts/)
4. **Task Breakdown**: Use `/speckit.tasks` to create dependency-ordered tasks.md
5. **Analysis**: Run `/speckit.analyze` for cross-artifact consistency validation
6. **Implementation**: Execute `/speckit.implement` to work through tasks
7. **Review**: Validate against constitution principles before merging

### Constitution Compliance Gates

All pull requests MUST pass these checks:
- [ ] Interfaces defined for new abstractions (Principle I)
- [ ] Concurrency patterns reviewed for safety (Principle II)
- [ ] Tests written before implementation (Principle III)
- [ ] Integration tests cover critical paths (Principle IV)
- [ ] Logging and error handling present (Principle V)
- [ ] Version bumped appropriately (Principle VI)
- [ ] Complexity justified if added (Principle VII)

## Testing Standards

### Test Coverage Requirements

- **Unit Tests**: All public functions and methods MUST have unit tests
- **Integration Tests**: All interface implementations MUST have contract tests
- **End-to-End Tests**: At least one happy path per user story

### Test Organization

```
tests/
├── contract/        # Interface contract tests (provider, VM, etc.)
├── integration/     # Multi-component integration tests
└── unit/           # Component-level unit tests
```

### Test Quality Standards

- Tests MUST be deterministic (no flakiness from timing, randomness, external state)
- Tests MUST be independent (order-independent execution)
- Tests MUST have clear arrange-act-assert structure
- Test names MUST describe behavior, not implementation

## Governance

### Amendment Process

1. Propose changes via pull request to `.specify/memory/constitution.md`
2. Document rationale and impact in PR description
3. Update dependent templates (plan, spec, tasks) for consistency
4. Bump version according to semantic versioning rules:
   - MAJOR: Principle removal or redefinition that breaks compatibility
   - MINOR: New principle or section added
   - PATCH: Clarifications, wording improvements, typo fixes
5. Update `LAST_AMENDED_DATE` to amendment date
6. Require approval from project maintainer(s)

### Versioning Policy

- Constitution changes trigger template propagation (via `/speckit.constitution`)
- Breaking changes require migration plan for in-flight features
- All specs created after a version change MUST comply with new version

### Compliance Review

- Constitution compliance is checked during `/speckit.analyze`
- Plan template includes "Constitution Check" gate (see plan-template.md:30-34)
- Non-compliance MUST be documented in Complexity Tracking table with justification

**Version**: 1.0.0 | **Ratified**: 2025-10-19 | **Last Amended**: 2025-10-19
