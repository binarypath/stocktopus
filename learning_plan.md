Project Plan: The Go & Lua Stock Screener
This document outlines the architecture, features, and implementation details for creating a powerful, real-time, command-line stock screener using Go and Lua.

1. Core Concepts & Architecture
The application is a long-running, stateful terminal program, not a one-off script.

The Engine: A State-Aware, Concurrent Loop

State: The most critical piece of state to hold in memory is a map of the previous tick for every stock being tracked (e.g., map[string]StockTick). This is essential for calculating price and volume changes.
Concurrency: Data fetching and processing must run in the background to prevent the UI from freezing.
A Ticker goroutine will trigger a data fetch every X seconds (configurable refresh interval).
A Worker Pool of goroutines will fetch data from the provider (Polygon) for multiple symbols concurrently.
Channels will pass fetched results from the workers back to a central processing component, which then updates the main application state and triggers a UI re-render.
The User Interface (UI): A Terminal UI (TUI)

To avoid screen flicker and create a stable dashboard, a TUI library is necessary.
Recommended Library: Bubble Tea (https://github.com/charmbracelet/bubbletea). It is modern, powerful, and uses the Model-View-Update architecture which is very suitable for this kind of application.
The Brain: Embedded Lua Scripting

Instead of a custom query language, we will embed a Lua interpreter to provide maximum flexibility.
Recommended Library: gopher-lua (https://github.com/yuin/gopher-lua). It is pure Go, making compilation and deployment simple.
Workflow:
The Go app initializes a Lua VM.
It loads a user-provided script (e.g., screener.lua).
For each stock tick, Go converts the data to a Lua table and passes it to a specific function in the Lua script (e.g., function screen(current, previous)).
The Lua script performs its logic and returns true or false.
The Go app reads the boolean result and decides whether to display the stock.
2. Feature Roadmap & Implementation Tiers
This provides a step-by-step path from a Minimum Viable Product (MVP) to a powerful platform.

Tier 1: The Core MVP
[ ] Basic Configuration: Create a config.yaml file to hold the Polygon API Key, a default refresh interval (e.g., 15s), and a static list of tickers to watch.
[ ] Provider Model: Solidify the StockProvider interface and the PolygonProvider implementation.
[ ] Lua Integration: Implement the core Go logic to load a Lua script and call a screen function with current and previous stock data tables.
[ ] Simple TUI List: Use Bubble Tea to display a basic, auto-refreshing list of stocks that return true from the Lua script.
Columns: Ticker, Price, Change (%), Volume.
Features: List updates dynamically (adds/removes stocks), and shows a message when the list is empty.
Tier 2: Power Features
[ ] Live Script Reloading: Use a file-watching library like fsnotify to monitor the user's .lua script. When the file is saved, automatically reload the Lua VM with the new logic without restarting the Go application.
[ ] Dynamic Ticker Discovery: Implement a feature to use Polygon's API to fetch a list of all tickers for a given market (e.g., all NASDAQ stocks), instead of relying on a static list.
[ ] Visual "Flash" Highlight: When a new stock first appears on the list, highlight its row with a bright color for one or two refresh cycles to draw the user's attention.
[ ] Screen Real Estate Management:
[ ] Detect terminal size.
[ ] Add a max_results setting to the config.
[ ] If the number of matches exceeds max_results, sort the list (e.g., by "most recent addition") and only display the top N results.
Tier 3: Advanced & "Nice-to-Have" Features
[ ] Interactive TUI Controls: Add keyboard shortcuts to the Bubble Tea interface.
[ ] p: Pause/Resume the refresh ticker.
[ ] s: Cycle through different sort orders (by % Change, Volume, Ticker).
[ ] q: Quit the application gracefully.
[ ] Event Logging: Log every time a stock enters or leaves the screened list to a file (events.log) with a timestamp for later analysis.
[ ] Detailed View: When a user selects a stock in the list and presses <Enter>, show a pop-up detail panel with more information (e.g., Day High/Low, 52-Week High/Low, etc.).
3. Example Code Snippets (For Reference)
Example screener.lua
Lua

-- This script defines the logic for our stock screener.
function screen(current, previous)
    -- Guard against missing previous data on the first run
    if previous == nil then
        return false
    end

    -- Calculate dollar volume (price * volume)
    local dollar_volume = current.price * current.volume

    -- Condition 1: Minimum price and significant trading activity
    if current.price < 10 or dollar_volume < 5000000 then
        return false
    end

    -- Condition 2: Price must have increased by at least 3% since the last check
    local price_change_pct = ((current.price - previous.price) / previous.price) * 100
    if price_change_pct < 3 then
        return false
    end

    -- If all conditions pass, show this stock.
    return true
end
Conceptual Go Function
Go

// Helper function to convert our struct to a Lua table
func stockTickToLuaTable(L *lua.LState, tick StockTick) *lua.LTable {
    tbl := L.NewTable()
    L.SetField(tbl, "ticker", lua.LString(tick.Ticker))
    L.SetField(tbl, "price", lua.LNumber(tick.Price))
    L.SetField(tbl, "volume", lua.LNumber(tick.Volume))
    // Add any other fields you need...
    return tbl
}
