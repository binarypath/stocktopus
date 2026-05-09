package trading

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// SECFetcher fetches SEC filing documents in compliance with EDGAR's fair-access
// policy: a self-identifying User-Agent is required, and requests should stay under
// 10/second per the SEC's developer guidance.
type SECFetcher struct {
	userAgent string
	client    *http.Client
	logger    *slog.Logger
}

func NewSECFetcher(logger *slog.Logger) *SECFetcher {
	ua := os.Getenv("SEC_USER_AGENT")
	if ua == "" {
		ua = "Stocktopus petercarnold@gmail.com"
	}
	return &SECFetcher{
		userAgent: ua,
		client:    &http.Client{Timeout: 45 * time.Second},
		logger:    logger.With("component", "sec-fetcher"),
	}
}

// FetchFilingText resolves an EDGAR index URL to the primary filing document and
// returns the document's text content. formType (e.g. "8-K", "10-K", "DEF 14A") is
// used to disambiguate when a filing has multiple primary candidates.
func (sf *SECFetcher) FetchFilingText(ctx context.Context, indexURL, formType string) (string, error) {
	body, err := sf.fetchPrimaryHTML(ctx, indexURL, formType)
	if err != nil {
		return "", err
	}
	return htmlToText(body), nil
}

// FetchLeadershipTables resolves the primary filing document, walks its HTML tables,
// and returns the concatenated text of the ones that look like director/executive
// summary or bio tables. Returns (text, true, nil) when leadership tables are found,
// (fullText, false, nil) when none match — caller should narrow further. Much smaller
// than the whole filing, which keeps Ollama inference time tractable on consumer GPUs.
func (sf *SECFetcher) FetchLeadershipTables(ctx context.Context, indexURL, formType string) (text string, fromTables bool, err error) {
	body, err := sf.fetchPrimaryHTML(ctx, indexURL, formType)
	if err != nil {
		return "", false, err
	}
	if tableText := extractLeadershipTables(body); tableText != "" {
		return tableText, true, nil
	}
	return htmlToText(body), false, nil
}

// fetchPrimaryHTML is the common path for FetchFilingText and FetchLeadershipTables.
func (sf *SECFetcher) fetchPrimaryHTML(ctx context.Context, indexURL, formType string) ([]byte, error) {
	baseURL, err := deriveBaseURL(indexURL)
	if err != nil {
		return nil, err
	}

	primaryName, err := sf.findPrimaryDocument(ctx, baseURL, formType)
	if err != nil {
		return nil, fmt.Errorf("locating primary doc: %w", err)
	}

	body, err := sf.httpGet(ctx, baseURL+primaryName)
	if err != nil {
		return nil, fmt.Errorf("fetching %s: %w", primaryName, err)
	}
	return body, nil
}

// httpGet performs a GET with the SEC-compliant User-Agent.
func (sf *SECFetcher) httpGet(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", sf.userAgent)
	// Don't set Accept-Encoding — Go's transport handles gzip transparently when unset.

	resp, err := sf.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sec http %d for %s", resp.StatusCode, url)
	}
	return io.ReadAll(resp.Body)
}

// findPrimaryDocument inspects FilingSummary.xml (preferred) or falls back to
// index.json heuristics to identify the primary filing document filename.
func (sf *SECFetcher) findPrimaryDocument(ctx context.Context, baseURL, formType string) (string, error) {
	// Preferred: FilingSummary.xml has an <InputFiles>/<File doctype="8-K" original="..."/> entry
	if name, err := sf.primaryFromFilingSummary(ctx, baseURL, formType); err == nil && name != "" {
		return name, nil
	}

	// Fallback: index.json + filename heuristics
	return sf.primaryFromIndexJSON(ctx, baseURL, formType)
}

func (sf *SECFetcher) primaryFromFilingSummary(ctx context.Context, baseURL, formType string) (string, error) {
	body, err := sf.httpGet(ctx, baseURL+"FilingSummary.xml")
	if err != nil {
		return "", err
	}

	type fileEntry struct {
		DocType  string `xml:"doctype,attr"`
		Original string `xml:"original,attr"`
		Value    string `xml:",chardata"`
	}
	var fs struct {
		InputFiles struct {
			File []fileEntry `xml:"File"`
		} `xml:"InputFiles"`
	}
	if err := xml.Unmarshal(body, &fs); err != nil {
		return "", err
	}

	// Match doctype to formType (case-insensitive, trim whitespace)
	want := strings.ToUpper(strings.TrimSpace(formType))
	for _, f := range fs.InputFiles.File {
		if strings.ToUpper(strings.TrimSpace(f.DocType)) == want {
			if f.Original != "" {
				return f.Original, nil
			}
			return strings.TrimSpace(f.Value), nil
		}
	}
	// Last resort: first file with a doctype attribute set
	for _, f := range fs.InputFiles.File {
		if f.DocType != "" {
			if f.Original != "" {
				return f.Original, nil
			}
			return strings.TrimSpace(f.Value), nil
		}
	}
	return "", errors.New("no primary doc in FilingSummary")
}

var indexFileRe = regexp.MustCompile(`(?i)(index|index-headers|filingsummary|metalinks)`)
var exhibitRe = regexp.MustCompile(`(?i)(^|[^a-z])ex\d|exhibit`)

func (sf *SECFetcher) primaryFromIndexJSON(ctx context.Context, baseURL, formType string) (string, error) {
	body, err := sf.httpGet(ctx, baseURL+"index.json")
	if err != nil {
		return "", err
	}
	var idx struct {
		Directory struct {
			Item []struct {
				Name string `json:"name"`
			} `json:"item"`
		} `json:"directory"`
	}
	if err := json.Unmarshal(body, &idx); err != nil {
		return "", err
	}

	// Pick the first .htm/.html file that isn't an index page or an exhibit.
	for _, it := range idx.Directory.Item {
		name := it.Name
		lower := strings.ToLower(name)
		if !strings.HasSuffix(lower, ".htm") && !strings.HasSuffix(lower, ".html") {
			continue
		}
		if indexFileRe.MatchString(lower) || exhibitRe.MatchString(lower) {
			continue
		}
		return name, nil
	}
	return "", errors.New("no primary html doc in directory listing")
}

// deriveBaseURL strips an EDGAR …-index.htm path back to its directory URL ending in '/'.
func deriveBaseURL(indexURL string) (string, error) {
	idx := strings.LastIndex(indexURL, "/")
	if idx < 0 {
		return "", fmt.Errorf("invalid SEC URL: %s", indexURL)
	}
	return indexURL[:idx+1], nil
}

// htmlToText extracts visible text from an HTML/XHTML document, collapsing
// runs of whitespace. Skips <script>, <style>, and inline iXBRL transformation
// nodes that aren't human-readable.
func htmlToText(body []byte) string {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		// Fallback: strip tags with a regex
		return collapseWhitespace(stripTagsRegex.ReplaceAllString(string(body), " "))
	}
	var b strings.Builder
	walkText(doc, &b)
	return collapseWhitespace(b.String())
}

var stripTagsRegex = regexp.MustCompile(`<[^>]+>`)
var wsRegex = regexp.MustCompile(`\s+`)

func walkText(n *html.Node, b *strings.Builder) {
	if n.Type == html.ElementNode {
		switch n.Data {
		case "script", "style", "head", "noscript":
			return
		}
	}
	if n.Type == html.TextNode {
		b.WriteString(n.Data)
		b.WriteByte(' ')
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		walkText(c, b)
	}
}

func collapseWhitespace(s string) string {
	return strings.TrimSpace(wsRegex.ReplaceAllString(s, " "))
}

// extractLeadershipTables finds tables in an SEC filing that summarise directors
// or executive officers and returns their concatenated text. Detection heuristics:
//   - Header row contains "Name" plus "Age" plus one of {"Since", "Position",
//     "Occupation", "Title"} → director / officer summary table
//   - Body contains "Director Since:" alongside "Age:" → individual bio cards
//
// Returns empty string when nothing matches so the caller can fall back to the
// full document text.
func extractLeadershipTables(body []byte) string {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return ""
	}
	var tables []*html.Node
	collectElements(doc, "table", &tables)

	var out strings.Builder
	for _, t := range tables {
		if !isLeadershipTable(t) {
			continue
		}
		var b strings.Builder
		walkText(t, &b)
		out.WriteString(collapseWhitespace(b.String()))
		out.WriteString("\n\n")
	}
	return strings.TrimSpace(out.String())
}

func isLeadershipTable(table *html.Node) bool {
	// Read a small slice of text from the start of the table — enough for the
	// header row plus a row or two of data.
	var b strings.Builder
	collectTextLimited(table, &b, 1500)
	preview := strings.ToLower(collapseWhitespace(b.String()))
	if preview == "" {
		return false
	}

	// Bio-card pattern: "Director Since:" + age field
	if strings.Contains(preview, "director since:") && strings.Contains(preview, "age") {
		return true
	}

	// Summary-table pattern: name + age + (since / position / occupation / title)
	hasName := strings.Contains(preview, "name")
	hasAge := strings.Contains(preview, "age")
	hasContext := strings.Contains(preview, "since") ||
		strings.Contains(preview, "position") ||
		strings.Contains(preview, "occupation") ||
		strings.Contains(preview, "title")
	if hasName && hasAge && hasContext {
		// Reject obvious non-leadership tables that happen to share keywords
		// (e.g. compensation tables that read "Name and Principal Position").
		// A real summary table almost always names "director" or "officer" within
		// the same preview window.
		return strings.Contains(preview, "director") || strings.Contains(preview, "officer")
	}
	return false
}

func collectElements(n *html.Node, tag string, out *[]*html.Node) {
	if n.Type == html.ElementNode && n.Data == tag {
		*out = append(*out, n)
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		collectElements(c, tag, out)
	}
}

// collectTextLimited writes node text into b until at least limit chars accumulate.
func collectTextLimited(n *html.Node, b *strings.Builder, limit int) {
	if b.Len() >= limit {
		return
	}
	if n.Type == html.ElementNode {
		switch n.Data {
		case "script", "style", "head", "noscript":
			return
		}
	}
	if n.Type == html.TextNode {
		b.WriteString(n.Data)
		b.WriteByte(' ')
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if b.Len() >= limit {
			return
		}
		collectTextLimited(c, b, limit)
	}
}
