Feature: Numbered tabs on the security page
  Each section of a security's detail page is reachable by a single digit, so a
  reader can flick between Overview, Financials, Estimates, News, AI Analysis,
  Sector, and SEC without ever touching the mouse. Losing these shortcuts would
  turn a one-keystroke jump into a hunt-and-click, breaking the rhythm of
  research.

  Background:
    Given the dev server is reachable
    And I am on the security page for "AAPL"

  Scenario: Pressing 2 jumps to the Financial Modeling tab
    When I press "2"
    Then the active tab is "Financial Modeling"
    And the browser URL should match "/security/AAPL"

  Scenario: Pressing 1 returns to the Overview tab
    When I press "2"
    And I press "1"
    Then the active tab is "Overview"
