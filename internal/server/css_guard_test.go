package server

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// css_guard_test.go — design-system guardrail.
//
// The system catalogues all brand colours in `:root` of style.css. New
// raw hex codes outside that block defeat the token layer (and the
// guidance in docs/design-language.md), so this test fails the build if
// the count of out-of-:root hex codes grows past the existing baseline.
//
// Lower the baseline as you migrate stragglers — the ratchet only goes
// one way.

const hexOutsideRootBaseline = 28

func TestStyleCSSHexBaseline(t *testing.T) {
	path := filepath.Join("static", "style.css")
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open style.css: %v", err)
	}
	defer f.Close()

	hexRe := regexp.MustCompile(`#[0-9a-fA-F]{3,8}\b`)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	inRoot := false
	count := 0
	var lines []int
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		// Detect :root { … } block. The file has exactly one :root
		// declaration; we toggle on the opening brace and off on the
		// matching close brace (the first `}` at column 0).
		if !inRoot && strings.HasPrefix(trimmed, ":root") {
			inRoot = true
			continue
		}
		if inRoot {
			if strings.HasPrefix(line, "}") {
				inRoot = false
			}
			continue
		}

		matches := hexRe.FindAllString(line, -1)
		if len(matches) > 0 {
			count += len(matches)
			lines = append(lines, lineNo)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan style.css: %v", err)
	}

	if count > hexOutsideRootBaseline {
		t.Errorf("hex codes outside :root: %d (baseline %d). New raw hex defeats the token system — define it in :root or use an existing token. First offending lines: %v",
			count, hexOutsideRootBaseline, lines[:min(10, len(lines))])
	}
	if count < hexOutsideRootBaseline {
		t.Logf("hex codes outside :root: %d (baseline %d) — drop the baseline in css_guard_test.go to ratchet down.",
			count, hexOutsideRootBaseline)
	}
}
