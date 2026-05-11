package fred

import "time"

// TTLForFrequency maps a FRED frequency_short to a cache-freshness window.
// Picked so the cache returns at the rate the source actually updates:
// FEDFUNDS moves daily during NYSE hours; GDP arrives once a quarter.
func TTLForFrequency(freq string) time.Duration {
	switch freq {
	case "D":
		return 6 * time.Hour
	case "W":
		return 24 * time.Hour
	case "M", "SM": // monthly / semi-monthly
		return 72 * time.Hour
	case "Q":
		return 7 * 24 * time.Hour
	case "A":
		return 30 * 24 * time.Hour
	default:
		// Unknown — refresh daily to be safe.
		return 24 * time.Hour
	}
}
