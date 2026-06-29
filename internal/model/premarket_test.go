package model

import (
	"math"
	"testing"
	"time"
)

func bar(date string, close float64) OHLCV {
	return OHLCV{Date: date, Open: close, High: close, Low: close, Close: close, Volume: 0}
}

func TestExtractPreMarket_PicksLastPreMarketBar(t *testing.T) {
	// Bars span pre-market and regular hours of one ET trading day. The window
	// is [04:00, 09:30). The latest in-window bar is 09:25 (103). The 09:30
	// opening-auction bar and the 09:35 regular bar must be ignored, as must
	// the 03:55 bar that falls before the window opens.
	bars := []OHLCV{
		bar("2024-03-01 03:55:00", 99),  // before window — excluded
		bar("2024-03-01 04:00:00", 100), // window opens (inclusive)
		bar("2024-03-01 09:00:00", 102),
		bar("2024-03-01 09:25:00", 103), // last pre-market bar
		bar("2024-03-01 09:30:00", 110), // opening auction — excluded
		bar("2024-03-01 09:35:00", 105), // regular session — excluded
	}

	pm := ExtractPreMarket(bars, 100.0, time.UTC)

	if !pm.Found {
		t.Fatalf("expected Found=true, got false")
	}
	if pm.Price != 103 {
		t.Errorf("expected last pre-market price 103, got %v", pm.Price)
	}
	// (103 - 100) / 100 * 100 = 3%
	if math.Abs(pm.ChangePercent-3.0) > 1e-9 {
		t.Errorf("expected change %% 3.0, got %v", pm.ChangePercent)
	}
}

func TestExtractPreMarket_NoPreMarketBars(t *testing.T) {
	// Only regular-session bars — nothing in the pre-market window.
	bars := []OHLCV{
		bar("2024-03-01 09:30:00", 110),
		bar("2024-03-01 12:00:00", 112),
		bar("2024-03-01 15:55:00", 111),
	}

	pm := ExtractPreMarket(bars, 100.0, time.UTC)

	if pm.Found {
		t.Errorf("expected Found=false for regular-session-only bars, got %+v", pm)
	}
}

func TestExtractPreMarket_NegativeChangeAndZeroPrevClose(t *testing.T) {
	bars := []OHLCV{bar("2024-03-01 08:00:00", 98)}

	pm := ExtractPreMarket(bars, 100.0, time.UTC)
	if !pm.Found || pm.Price != 98 {
		t.Fatalf("expected found price 98, got %+v", pm)
	}
	if math.Abs(pm.ChangePercent-(-2.0)) > 1e-9 {
		t.Errorf("expected -2.0%%, got %v", pm.ChangePercent)
	}

	// prevClose <= 0 must not divide by zero; percent should be 0.
	pmZero := ExtractPreMarket(bars, 0, time.UTC)
	if !pmZero.Found || pmZero.ChangePercent != 0 {
		t.Errorf("expected found with 0%% change for zero prevClose, got %+v", pmZero)
	}
}
