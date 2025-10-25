package provider

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ParsePrice converts string or numeric types to float64 dollars
// Handles: string "158.5400", float64 158.54, int 158
// Always returns dollars, never cents
func ParsePrice(raw interface{}) (float64, error) {
	switch v := raw.(type) {
	case string:
		price, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid price string %q: %w", v, err)
		}
		return price, nil
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	default:
		return 0, fmt.Errorf("invalid price type: %T", raw)
	}
}

// ParseVolume converts string or numeric types to int64 shares
// Handles: string "6640217", int64 6640217, float64 6640217.0
// Always returns integer shares traded
func ParseVolume(raw interface{}) (int64, error) {
	switch v := raw.(type) {
	case string:
		volume, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid volume string %q: %w", v, err)
		}
		return volume, nil
	case int64:
		return v, nil
	case int:
		return int64(v), nil
	case float64:
		return int64(v), nil
	case float32:
		return int64(v), nil
	default:
		return 0, fmt.Errorf("invalid volume type: %T", raw)
	}
}

// ParsePercentage converts "1.23%" string or 1.23 float to 0.0123 decimal
// Handles: string "1.3618%", float64 1.23
// Always returns decimal representation (1.5% = 0.015)
func ParsePercentage(raw interface{}) (float64, error) {
	switch v := raw.(type) {
	case string:
		// Remove % suffix if present
		v = strings.TrimSuffix(strings.TrimSpace(v), "%")
		pct, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid percentage string %q: %w", v, err)
		}
		// Convert percentage to decimal
		return pct / 100.0, nil
	case float64:
		// Assume already percentage, convert to decimal
		return v / 100.0, nil
	case float32:
		return float64(v) / 100.0, nil
	default:
		return 0, fmt.Errorf("invalid percentage type: %T", raw)
	}
}

// ParseTimestamp converts various formats to time.Time in UTC
// Handles:
// - ISO 8601 strings (RFC3339)
// - Date-only strings ("2006-01-02")
// - Unix milliseconds (int64 > 1e12)
// - Unix seconds (int64 <= 1e12, float64)
// Always returns time.Time in UTC timezone
func ParseTimestamp(raw interface{}) (time.Time, error) {
	switch v := raw.(type) {
	case string:
		// Try ISO 8601 / RFC3339 format
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			return t.UTC(), nil
		}
		// Try RFC3339 with nanoseconds
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			return t.UTC(), nil
		}
		// Try date-only format (EOD timestamp)
		if t, err := time.Parse("2006-01-02", v); err == nil {
			return t.UTC(), nil
		}
		// Try common datetime formats
		formats := []string{
			"2006-01-02 15:04:05",
			"2006-01-02T15:04:05",
			"01/02/2006 15:04:05",
		}
		for _, format := range formats {
			if t, err := time.Parse(format, v); err == nil {
				return t.UTC(), nil
			}
		}
		return time.Time{}, fmt.Errorf("unparseable timestamp string: %q", v)
	case int64:
		// Unix milliseconds (> 1e12) or seconds (<= 1e12)
		if v > 1e12 {
			return time.Unix(0, v*int64(time.Millisecond)).UTC(), nil
		}
		return time.Unix(v, 0).UTC(), nil
	case int:
		return time.Unix(int64(v), 0).UTC(), nil
	case float64:
		// Unix seconds with fractional part
		sec := int64(v)
		nsec := int64((v - float64(sec)) * 1e9)
		return time.Unix(sec, nsec).UTC(), nil
	case time.Time:
		return v.UTC(), nil
	default:
		return time.Time{}, fmt.Errorf("invalid timestamp type: %T", raw)
	}
}
