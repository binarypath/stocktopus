Feature: Watchlist columns carry duration and trend at a glance
  A trader skimming the watchlist should see, for every security, today's move,
  the move over the last week, the move over six months, and the shape of that
  six-month trend — without clicking into a chart. The column headers should
  say what they mean (no bare "Change") and the stale "Updated" timestamp
  shouldn't take up space now that prices update live.

  Background:
    Given the dev server is reachable
    And the default watchlist has at least one security
    And I am on the watchlist page

  Scenario: Column headers carry duration labels
    Then the watchlist header row contains "Price :live:"
    And the watchlist header row contains "Change 1d"
    And the watchlist header row contains "Change % 1d"
    And the watchlist header row contains "Change 1w"
    And the watchlist header row contains "Change % 1w"
    And the watchlist header row contains "Change 6m"
    And the watchlist header row does not contain "Updated"

  Scenario: The first row populates its weekly and six-month change cells
    Then the first watchlist row eventually has a populated cell with id suffix "change1w"
    And the first watchlist row eventually has a populated cell with id suffix "changepct1w"
    And the first watchlist row eventually has a populated cell with id suffix "change6m"

  Scenario: The first row renders a six-month sparkline
    Then the first watchlist row eventually has a sparkline

  Scenario: Sparklines survive a watchlist tab switch
    Then the first watchlist row eventually has a sparkline
    When I switch to the next watchlist tab
    And I switch to the previous watchlist tab
    Then the first watchlist row's sparkline canvas is the host's width

  Scenario: The price preview shows the shared company info panel
    When I press the keys "jp"
    Then the preview slide-in is visible
    And the preview slide-in contains a company info panel
