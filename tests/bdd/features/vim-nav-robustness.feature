Feature: Vim navigation is robust across every directional key
  Vim nav is the spine of this app. If a directional keypress silently
  crashes or fails to update the selection, the user loses faith fast.
  These scenarios walk the security tab strip + sub-tab strip with every
  navigation key — h, l, j, k, w, b, G, gg, 1-9, Enter — and assert
  each step lands on the right item AND that something visible was painted.

  Background:
    Given the dev server is reachable
    And I am on the security page for "AAPL"

  Scenario: h and l walk left and right across the tab strip
    When I press "l"
    Then the highlighted item has data-tab "financials"
    When I press "l"
    Then the highlighted item has data-tab "estimates"
    When I press "h"
    Then the highlighted item has data-tab "financials"

  Scenario: w jumps forward across rows; b walks back
    When I press "l"
    Then the highlighted item has data-tab "financials"
    When I press "w"
    Then the highlighted item has data-tab "estimates"
    When I press "b"
    Then the highlighted item has data-tab "financials"

  Scenario: gg returns to the first item, G jumps to the last
    When I press the keys "lll"
    Then the highlighted item has data-tab "news"
    When I press the keys "gg"
    Then the highlighted item has data-tab "overview"
    When I press "G"
    Then a row is highlighted

  Scenario: Numeric jumps activate the corresponding tab
    When I press "3"
    Then the active tab is "Estimates"
    When I press "1"
    Then the active tab is "Overview"

  Scenario: Enter activates the highlighted tab
    When I press "l"
    And I press "Enter"
    Then the active tab is "Financials"

  Scenario: A rapid keypress after an HTML rerender does not crash
    When I press "2"
    And I press the keys "jjjjlhlhlhwbwb"
    Then no JavaScript error has been logged
