package server

import (
	"math"
	"testing"
)

func TestRollingBeta_Identical(t *testing.T) {
	// If target == benchmark, beta must equal 1.0 (a series perfectly
	// covaries with itself). Smallest window we accept is 2 — gives us 1
	// beta value out of 3 aligned points.
	prices := []pricePoint{
		{Date: "2026-01-04", Price: 110}, // descending — FMP order
		{Date: "2026-01-03", Price: 108},
		{Date: "2026-01-02", Price: 105},
		{Date: "2026-01-01", Price: 100},
	}
	out, err := rollingBeta(prices, prices, 2)
	if err != nil {
		t.Fatalf("rollingBeta: %v", err)
	}
	if len(out) == 0 {
		t.Fatalf("expected at least one beta point, got 0")
	}
	for _, b := range out {
		if math.Abs(b.Value-1.0) > 1e-9 {
			t.Errorf("beta on identical series should be 1.0, got %.6f on %s", b.Value, b.Date)
		}
	}
}

func TestRollingBeta_NotEnoughData(t *testing.T) {
	prices := []pricePoint{
		{Date: "2026-01-02", Price: 101},
		{Date: "2026-01-01", Price: 100},
	}
	// Window 252 with 2 points → must error.
	if _, err := rollingBeta(prices, prices, 252); err == nil {
		t.Fatal("expected error for insufficient history, got nil")
	}
}
