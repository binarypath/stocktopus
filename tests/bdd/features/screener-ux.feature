Feature: Screener UX — collapsible filters, help text, preview, presets
  The screener is a sidebar full of filter inputs feeding a results table.
  Quietly losing UX affordances here (the keyboard preview, the size presets,
  the help-toggle that explains what each filter means) makes the page feel
  like a wall of unlabeled controls. These scenarios keep the discoverable
  bits discoverable.

  Background:
    Given the dev server is reachable
    And I am on the screener page

  Scenario: Filter groups start collapsed
    Then every filter group is collapsed

  Scenario: Market cap presets fill the minimum and maximum inputs
    When I open the "Fundamentals" filter group
    And I click the "large" market cap preset
    Then the market cap minimum input contains "10bn"
    And the market cap maximum input contains "200bn"

  Scenario: Shorthand market-cap input is parsed on submit
    When I open the "Fundamentals" filter group
    And I type "1bn" into the market cap minimum input
    And I run the screen
    Then the screener request used "marketCapMoreThan=1000000000"

  Scenario: Pressing ? toggles per-filter help text
    When I open the "Fundamentals" filter group
    Then no filter help text is visible
    When I press "?"
    Then filter help text is visible
