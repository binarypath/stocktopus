Feature: The news page uses the common vim navigation
  News was the page the UI overhaul broke — its bespoke handler was starved
  when the company panel claimed the declarative grid. It now rides the same
  region engine as every tab page: h/l walks the category tabs, j drops into
  the article cards, numbered jumps switch category, and a key-mash never
  crashes.

  Background:
    Given the dev server is reachable
    And I am on the news page

  Scenario: h/l walks the category tab strip
    When I press "l"
    Then the highlighted element matches ".news-tab"
    When I press "l"
    Then the highlighted element matches ".news-tab"
    When I press "h"
    Then the highlighted element matches ".news-tab"

  Scenario: j drops from the tabs into the article cards
    When I press "l"
    And I press "j"
    Then the highlighted element matches ".news-card"
    When I press "j"
    Then the highlighted element matches ".news-card"

  Scenario: A numbered jump highlights a category tab
    When I press "2"
    Then the highlighted element matches ".news-tab"

  Scenario: A rapid keypress run never crashes
    When I press the keys "lljjkkhhljk"
    Then no JavaScript error has been logged
