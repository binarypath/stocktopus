package screener

import (
	"stocktopus/internal/model"
	"testing"
)

func TestFilterStocks(t *testing.T) {
	// set up test data table
	testStocks := []model.Stock{
		{Ticker: "PASS_1", Volume: 50_000_000},
		{Ticker: "FAIL_2", Volume: 10_000_000},
		{Ticker: "PASS_3", Volume: 40_000_000},
	}

	expectedCount := 2
	expectedTickers := map[string]bool{
		"PASS_1": true,
		"PASS_3": true,
	}

	filtered := filterStocks(testStocks)

	if len(filtered) != expectedCount {
		t.Errorf("epected %d stocks,but got %d", expectedCount, len(filtered))
	}

	for _, stock := range filtered {
		if !expectedTickers[stock.Ticker] {
			t.Errorf("Got unexpected ticker %s in filtered results", stock.Ticker)
		}
	}

}
