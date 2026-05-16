package econ

import "time"

// TTLForFrequency maps a frequency code to a cache-freshness window. Each
// source's response frequency is normalised into D/W/M/Q/A by the
// prefetcher before this lookup; DBnomics's "daily" / "monthly" / etc.
// strings get translated by NormaliseFrequency below.
func TTLForFrequency(freq string) time.Duration {
	switch freq {
	case "D":
		return 6 * time.Hour
	case "W":
		return 24 * time.Hour
	case "M", "SM":
		return 72 * time.Hour
	case "Q":
		return 7 * 24 * time.Hour
	case "A":
		return 30 * 24 * time.Hour
	default:
		return 24 * time.Hour
	}
}

// NormaliseFrequency coerces a provider's frequency string into our
// canonical D/W/M/Q/A bucket. FRED's `frequency_short` already speaks this
// dialect; DBnomics's `@frequency` uses long words.
func NormaliseFrequency(s string) string {
	switch s {
	case "D", "W", "M", "Q", "A", "SM":
		return s
	case "daily":
		return "D"
	case "weekly", "bi-weekly":
		return "W"
	case "monthly", "semi-monthly":
		return "M"
	case "quarterly":
		return "Q"
	case "annual", "yearly":
		return "A"
	}
	return ""
}
