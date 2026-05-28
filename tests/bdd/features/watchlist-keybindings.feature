Feature: Watchlist vim keybindings stay working
  Power users navigate the watchlist entirely from the keyboard, and they expect
  the same short, single-letter shortcuts every time they sit down. If these
  silently regress, muscle memory leads them to the wrong screen and trust in
  the terminal erodes fast.

  Background:
    Given the dev server is reachable
    And the default watchlist has at least one security
    And I am on the watchlist page

  Scenario: Pressing c on a highlighted security opens its chart page
    When I press the keys "jc"
    Then the browser URL should match "/graph/[A-Z]+"

  Scenario: Pressing p on a highlighted security opens a price preview
    When I press the keys "jp"
    Then the preview slide-in is visible
    And the preview slide-in title contains "1y"

  Scenario: Escape closes the preview slide-in
    When I press the keys "jp"
    And I press "Escape"
    Then the preview slide-in is hidden
