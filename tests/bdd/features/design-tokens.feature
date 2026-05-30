Feature: Design tokens and st-* primitives are in effect
  The design language unification introduces a single set of CSS tokens and
  reusable st-* primitive classes. These scenarios pin down that the tokens
  resolve to real values and that the Info reference page is dual-written —
  legacy class names stay alongside the new ones during migration, and the
  new ones must actually take effect.

  Background:
    Given the dev server is reachable

  Scenario: The accent-orange token resolves to a saturated brand colour
    Given I am on the watchlist page
    Then the computed value of CSS variable "--accent-orange" is "rgb(255, 154, 26)"
    And the computed value of CSS variable "--orange" is the same as "--accent-orange"

  Scenario: The Info reference page dual-writes st-tab on the active tab
    Given I am on the security page for "AAPL"
    Then the active tab carries the class "st-tab--active"
    And the tab strip carries the class "st-tab-row"

  Scenario: The sector peer table renders with the shared st-table primitive
    Given I am on the security page for "AAPL"
    When I press "6"
    Then the peer table carries the class "st-table"
    And the peer symbol cells carry the class "st-link-sym"

  Scenario: The economics page tab strip uses the design primitive
    Given I am on the economics page
    Then the tab strip "#economics-tabs" carries the class "st-tab-row"
    And the active tab in "#economics-tabs" carries the class "st-tab--active"

  Scenario: The stock chart range bar uses the blue tab strip primitive
    Given I am on the stock chart page for "AAPL"
    Then the tab strip "#chart-range-bar" carries the class "st-tab-row"
    And the tab strip "#chart-range-bar" carries the class "st-tab-row--blue"
    And the active tab in "#chart-range-bar" carries the class "st-tab--active"

  Scenario: An active screener preset chip carries the new pill fill
    Given I am on the screener page
    When I open the "Fundamentals" filter group
    And I click the "large" market cap preset
    Then the active screener preset has a saturated orange background

  Scenario: Vim row selection paints a rail and a brand surface
    Given I am on the watchlist page
    And the default watchlist has at least one security
    When I press "j"
    Then the highlighted row's background contains "rgb"
    And the highlighted row's box-shadow is non-empty
