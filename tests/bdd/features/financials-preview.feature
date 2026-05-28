Feature: Financials metric preview
  When studying a company's numbers, a quick peek at how a single metric has
  moved over five years is the difference between a snap judgement and a real
  read. The preview slide-in must open from the highlighted row with one
  keystroke, so the analyst never loses their place in the table.

  Background:
    Given the dev server is reachable
    And I am on the security page for "AAPL"

  Scenario: Pressing p on a highlighted financials row opens a 5-year preview chart
    When I press the keys "2jjj"
    Then a row is highlighted
    When I press "p"
    Then the preview slide-in is visible
    And the preview slide-in title contains "5y"
