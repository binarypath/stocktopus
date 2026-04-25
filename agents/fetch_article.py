#!/usr/bin/env python3
"""Distinguished Reader Bot 9000 — fetches and extracts article text.
Entity extraction is handled client-side via FMP search API."""
import json
import os
import re
import subprocess
import sys
import time
import requests
from bs4 import BeautifulSoup

LOG_PREFIX = "[reader-bot-9000]"

def log(msg):
    print(f"{LOG_PREFIX} {msg}", file=sys.stderr)


CHROME_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}


def fetch_article(url):
    """Try multiple strategies to fetch article content. Returns (html, strategy_name) or (None, error)."""
    strategies = [
        ("chrome-headers", fetch_as_chrome),
        ("googlebot", fetch_as_googlebot),
        ("headless-chrome", fetch_headless_chrome),
    ]

    for name, fetcher in strategies:
        log(f"trying {name}...")
        t0 = time.time()
        try:
            html, final_url = fetcher(url)
        except Exception as e:
            log(f"  {name} exception: {e}")
            continue

        elapsed = time.time() - t0

        if not html or len(html) < 500:
            log(f"  {name} returned no/short content ({len(html) if html else 0} bytes) in {elapsed:.1f}s")
            continue

        # Validate: can we actually extract paragraphs from this HTML?
        title, paragraphs = extract_content(html)
        word_count = sum(len(p["text"].split()) for p in paragraphs) if paragraphs else 0

        if word_count < 30:
            log(f"  {name} got HTML ({len(html)} bytes) but only {word_count} words extracted in {elapsed:.1f}s")
            continue

        blockers = ["enable javascript", "enable js", "please turn javascript",
                     "browser doesn't support", "cookies are disabled"]
        full_text = " ".join(p["text"] for p in paragraphs)
        if any(b in full_text.lower() for b in blockers):
            log(f"  {name} blocked by JS/cookie wall in {elapsed:.1f}s")
            continue

        log(f"  {name} success: {len(html)} bytes, {len(paragraphs)} paras, {word_count} words in {elapsed:.1f}s")
        return html, name

    log("all strategies failed")
    return None, "all fetch strategies failed"


def fetch_as_chrome(url):
    """Standard HTTP fetch with Chrome headers."""
    session = requests.Session()
    session.headers.update(CHROME_HEADERS)
    resp = session.get(url, timeout=10, allow_redirects=True)
    resp.raise_for_status()
    return resp.text, resp.url


def fetch_as_googlebot(url):
    """Fetch as Googlebot — some sites serve pre-rendered HTML."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
    }
    resp = requests.get(url, headers=headers, timeout=10, allow_redirects=True)
    return resp.text, resp.url


def fetch_headless_chrome(url):
    """Use Chrome in headless mode for JS-rendered sites."""
    chrome_paths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ]
    chrome = None
    for p in chrome_paths:
        if os.path.exists(p):
            chrome = p
            break

    if not chrome:
        log("  headless-chrome: no Chrome binary found")
        raise FileNotFoundError("Chrome not found")

    log(f"  headless-chrome: using {chrome}")
    result = subprocess.run(
        [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--disable-dev-shm-usage", "--virtual-time-budget=8000",
         "--dump-dom", url],
        capture_output=True, text=True, timeout=20,
    )

    if result.returncode != 0:
        stderr_snippet = result.stderr[:200] if result.stderr else "no stderr"
        log(f"  headless-chrome: exit code {result.returncode}, stderr: {stderr_snippet}")
        raise RuntimeError(f"Chrome exited with {result.returncode}")

    if len(result.stdout) < 200:
        log(f"  headless-chrome: output too short ({len(result.stdout)} bytes)")
        raise ValueError("Chrome output too short")

    return result.stdout, url


def extract_content(html):
    """Extract article text from HTML. Returns (title, paragraphs)."""
    soup = BeautifulSoup(html, "html.parser")

    # Remove noise
    for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                     "iframe", "form", "noscript", "svg", "button", "input"]):
        tag.decompose()
    for cls in ["ad", "advertisement", "social-share", "newsletter", "popup",
                "modal", "cookie", "banner", "sidebar", "related"]:
        for el in soup.find_all(class_=re.compile(cls, re.I)):
            el.decompose()

    # Find article body
    article = None
    for sel in ["article", '[role="main"]', ".article-body", ".article__body",
                ".ArticleBody-articleBody", ".post-content", ".entry-content",
                ".story-body", ".article-content", ".caas-body",
                '[data-testid="article-body"]', ".article-text",
                ".story-content", ".post-body", "main"]:
        article = soup.select_one(sel)
        if article:
            break
    if not article:
        article = soup.body or soup

    # Title
    title = ""
    for sel in ["h1", "title"]:
        el = soup.find(sel)
        if el:
            title = el.get_text(strip=True)
            if title:
                break

    # Paragraphs
    paragraphs = []
    for p in article.find_all(["p", "h1", "h2", "h3", "h4", "h5", "blockquote", "li"]):
        text = p.get_text(strip=True)
        if len(text) > 15:
            paragraphs.append({"tag": p.name, "text": text})

    return title, paragraphs[:60]


# ── LLM Entity Extraction ──

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
CONFIDENCE_THRESHOLD = 0.6

NER_PROMPT = """Extract named entities from this financial article text. Return ONLY a valid JSON array.
Each entity: {"text": "exact text", "type": "ticker|company|person|sector|index", "ticker": "AAPL or null", "confidence": 0.0-1.0}

Rules:
- ticker: stock/crypto symbols like AAPL, MSFT, BTC
- company: company names like "Apple Inc.", "Meta Platforms"
- person: people names like "Tim Cook", "Warren Buffett"
- sector: industry terms like "semiconductor", "artificial intelligence"
- index: market indices like "S&P 500", "Nasdaq", "Dow Jones"
- For company entities, include the ticker if you know it
- confidence: how certain you are (1.0 = certain, 0.5 = guess)

Text:
"""


def call_ollama(prompt):
    """Call local Ollama for NER. Returns raw text or None."""
    try:
        log("calling Ollama for entity extraction...")
        resp = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 2048},
            },
            timeout=60,
        )
        if resp.status_code != 200:
            log(f"Ollama returned {resp.status_code}")
            return None
        result = resp.json().get("response", "")
        log(f"Ollama returned {len(result)} chars")
        return result
    except requests.exceptions.ConnectionError:
        log("Ollama not available (connection refused)")
        return None
    except requests.exceptions.Timeout:
        log("Ollama timed out (60s)")
        return None
    except Exception as e:
        log(f"Ollama error: {e}")
        return None


def call_gemini(prompt):
    """Escalate to Gemini Flash. Returns raw text or None."""
    if not GEMINI_KEY:
        return None
    try:
        log("escalating to Gemini Flash...")
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048},
            },
            timeout=30,
        )
        if resp.status_code != 200:
            log(f"Gemini returned {resp.status_code}")
            return None
        data = resp.json()
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        result = parts[0].get("text", "") if parts else None
        log(f"Gemini returned {len(result) if result else 0} chars")
        return result
    except Exception as e:
        log(f"Gemini error: {e}")
        return None


def parse_entities_json(text):
    """Parse JSON array from LLM response, stripping markdown."""
    if not text:
        log("parse: empty response")
        return []
    text = text.strip()
    # Strip markdown code blocks
    if text.startswith("```"):
        text = re.sub(r'^```\w*\n?', '', text)
        text = re.sub(r'\n?```$', '', text)
        text = text.strip()
    try:
        entities = json.loads(text)
        if isinstance(entities, list):
            log(f"parse: got {len(entities)} entities")
            return entities
    except json.JSONDecodeError as e:
        log(f"parse: direct JSON failed: {e}")
        # Try to find JSON array in response
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            try:
                entities = json.loads(match.group())
                log(f"parse: extracted {len(entities)} entities from regex match")
                return entities
            except json.JSONDecodeError as e2:
                log(f"parse: regex match also failed: {e2}")
                # Try fixing truncated JSON by closing brackets
                attempt = match.group()
                # Count open/close brackets
                opens = attempt.count('[') + attempt.count('{')
                closes = attempt.count(']') + attempt.count('}')
                if opens > closes:
                    attempt = attempt.rstrip(',\n ') + '}]' * (opens - closes)
                    try:
                        entities = json.loads(attempt)
                        log(f"parse: fixed truncated JSON, got {len(entities)} entities")
                        return entities
                    except json.JSONDecodeError:
                        pass
    log(f"parse: failed, first 200 chars: {text[:200]}")
    return []


def extract_entities(full_text):
    """Extract entities: Ollama first, escalate low-confidence to Gemini."""
    # Keep it short — LLMs struggle with very long text for NER
    truncated = full_text[:2000]
    prompt = NER_PROMPT + truncated

    # Step 1: Try Ollama
    raw = call_ollama(prompt)
    entities = parse_entities_json(raw)

    if not entities:
        # Ollama failed — try Gemini as full fallback
        raw = call_gemini(prompt)
        entities = parse_entities_json(raw)
        for e in entities:
            e["source"] = "gemini"
        log(f"entities from Gemini: {len(entities)}")
        return entities

    log(f"entities from Ollama: {len(entities)}")

    # Step 2: Escalate low-confidence to Gemini
    low_conf = [e for e in entities if e.get("confidence", 1.0) < CONFIDENCE_THRESHOLD]
    high_conf = [e for e in entities if e.get("confidence", 1.0) >= CONFIDENCE_THRESHOLD]

    if low_conf and GEMINI_KEY:
        low_texts = [e.get("text", "") for e in low_conf]
        escalation_prompt = f"""These entity extractions from a financial article have low confidence.
Verify each and return ONLY a JSON array with corrected entities.
Each: {{"text": "...", "type": "ticker|company|person|sector|index", "ticker": "AAPL or null", "confidence": 0.0-1.0}}

Low confidence entities: {json.dumps(low_texts)}

Context:
{truncated[:2000]}"""

        raw = call_gemini(escalation_prompt)
        escalated = parse_entities_json(raw)
        for e in escalated:
            e["source"] = "gemini-escalated"
        high_conf.extend(escalated)
        log(f"escalated {len(low_conf)} low-conf entities, got {len(escalated)} back")
    else:
        high_conf.extend(low_conf)

    for e in high_conf:
        if "source" not in e:
            e["source"] = "ollama"

    return high_conf


def collect_entity_summary(entities):
    """Collect ticker/company/people/sector lists from entities."""
    # Tickers: from ticker entities AND from company entities that have a ticker field
    tickers = set()
    for e in entities:
        if e.get("type") == "ticker":
            tickers.add(e.get("ticker") or e.get("text", ""))
        elif e.get("ticker"):
            tickers.add(e["ticker"])
    tickers = list(tickers - {""})

    companies = list(set(
        e.get("text", "") for e in entities if e.get("type") == "company" and e.get("text")
    ))
    people = list(set(
        e.get("text", "") for e in entities if e.get("type") == "person" and e.get("text")
    ))
    sectors = list(set(
        e.get("text", "") for e in entities if e.get("type") in ("sector", "index") and e.get("text")
    ))
    return tickers, companies, people, sectors


# ── Main ──

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no URL provided"}))
        sys.exit(1)

    url = sys.argv[1]
    log(f"fetching: {url}")
    start = time.time()

    # Step 1: Fetch HTML
    html, strategy = fetch_article(url)
    if html is None:
        log(f"failed after {time.time() - start:.1f}s")
        print(json.dumps({"error": f"fetch failed: {strategy}", "url": url}))
        sys.exit(0)

    # Step 2: Extract text
    title, paragraphs = extract_content(html)

    if not paragraphs:
        log(f"no paragraphs extracted via {strategy} after {time.time() - start:.1f}s")
        print(json.dumps({
            "error": "no content extracted",
            "url": url, "title": title or "",
            "paragraphs": [],
        }))
        sys.exit(0)

    word_count = sum(len(p["text"].split()) for p in paragraphs)
    log(f"extracted {len(paragraphs)} paragraphs, {word_count} words via {strategy} in {time.time() - start:.1f}s")

    # Step 3: Check if --no-llm flag is set (fast mode)
    skip_llm = "--no-llm" in sys.argv

    entities = []
    tickers, companies, people, sectors = [], [], [], []

    if not skip_llm and word_count >= 30:
        full_text = title + "\n" + "\n".join(p["text"] for p in paragraphs)
        entities = extract_entities(full_text)
        tickers, companies, people, sectors = collect_entity_summary(entities)
        log(f"entities: {len(tickers)} tickers, {len(companies)} companies, {len(people)} people, {len(sectors)} sectors")
    elif skip_llm:
        log("LLM skipped (--no-llm mode)")
    else:
        log(f"skipping LLM — too little content ({word_count} words)")

    result = {
        "title": title,
        "url": url,
        "paragraphs": paragraphs,
        "wordCount": word_count,
        "tickers": tickers,
        "companies": companies,
        "people": people,
        "sectors": sectors,
        "entityCount": len(entities),
        "strategy": strategy,
        "bot": "Distinguished Reader Bot 9000",
    }

    log(f"done in {time.time() - start:.1f}s")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
