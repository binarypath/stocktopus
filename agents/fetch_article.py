#!/usr/bin/env python3
"""Distinguished Reader Bot 9000 — fetches, extracts, and enriches articles.
Uses Ollama (Gemma 4) for entity extraction, escalates low-confidence to Gemini Flash."""
import json
import os
import re
import subprocess
import sys
import requests
from bs4 import BeautifulSoup

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

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

NER_PROMPT = """Extract named entities from this financial article text. Return ONLY valid JSON array.
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

CONFIDENCE_THRESHOLD = 0.6


def fetch_article(url):
    """Try multiple strategies to fetch article content."""
    strategies = [
        ("headless-chrome", fetch_headless_chrome),
        ("googlebot", fetch_as_screen_reader),
        ("chrome", fetch_as_chrome),
        ("google-cache", fetch_google_cache),
        ("12ft", fetch_12ft),
        ("archive", fetch_archive),
    ]

    for name, fetcher in strategies:
        html, final_url = fetcher(url)
        if html and len(html) > 500:
            # Quick check: does it have actual article content?
            soup = BeautifulSoup(html, "html.parser")
            text = soup.get_text()
            if len(text) > 200 and "enable javascript" not in text.lower() and "enable js" not in text.lower():
                return html, final_url
    return None, "all fetch strategies failed"


def fetch_headless_chrome(url):
    """Use actual Chrome in headless mode — renders JS, bypasses most blocks."""
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
        return None, None

    try:
        result = subprocess.run(
            [chrome, "--headless", "--disable-gpu", "--no-sandbox",
             "--disable-dev-shm-usage", "--virtual-time-budget=8000",
             "--dump-dom", url],
            capture_output=True, text=True, timeout=25,
        )
        if result.returncode == 0 and len(result.stdout) > 200:
            return result.stdout, url
    except Exception:
        pass
    return None, None


def fetch_as_screen_reader(url):
    """Fetch as Googlebot — sites serve pre-rendered HTML to crawlers."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        return resp.text, resp.url
    except Exception:
        return None, None


def fetch_as_chrome(url):
    """Standard Chrome browser fetch."""
    session = requests.Session()
    session.headers.update(CHROME_HEADERS)
    try:
        resp = session.get(url, timeout=15, allow_redirects=True)
        resp.raise_for_status()
        return resp.text, resp.url
    except Exception:
        return None, None


def fetch_google_cache(url):
    """Try Google's webcache for paywalled/JS-heavy sites."""
    cache_url = f"https://webcache.googleusercontent.com/search?q=cache:{url}&strip=1"
    cache_headers = dict(CHROME_HEADERS)
    cache_headers["Accept-Encoding"] = "identity"
    try:
        resp = requests.get(cache_url, headers=cache_headers, timeout=10, allow_redirects=True)
        if resp.status_code == 200 and len(resp.text) > 500:
            return resp.text, url
    except Exception:
        pass
    return None, None


def fetch_12ft(url):
    """Try 12ft.io proxy to bypass paywalls."""
    try:
        proxy_url = f"https://12ft.io/api/proxy?q={url}"
        resp = requests.get(proxy_url, headers=CHROME_HEADERS, timeout=10, allow_redirects=True)
        if resp.status_code == 200 and len(resp.text) > 500:
            return resp.text, url
    except Exception:
        pass
    return None, None


def fetch_archive(url):
    """Try archive.org's Wayback Machine."""
    try:
        api = f"https://archive.org/wayback/available?url={url}"
        resp = requests.get(api, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            snapshot = data.get("archived_snapshots", {}).get("closest", {})
            if snapshot.get("available"):
                archive_url = snapshot["url"]
                resp2 = requests.get(archive_url, headers=CHROME_HEADERS, timeout=10)
                if resp2.status_code == 200:
                    return resp2.text, url
    except Exception:
        pass
    return None, None


def extract_content(html):
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                     "iframe", "form", "noscript", "svg", "button", "input"]):
        tag.decompose()
    for cls in ["ad", "advertisement", "social-share", "newsletter", "popup",
                "modal", "cookie", "banner", "sidebar", "related"]:
        for el in soup.find_all(class_=re.compile(cls, re.I)):
            el.decompose()

    article = None
    for sel in ["article", '[role="main"]', ".article-body", ".article__body",
                ".post-content", ".entry-content", ".story-body", ".article-content",
                ".caas-body", '[data-testid="article-body"]', "main"]:
        article = soup.select_one(sel)
        if article:
            break
    if not article:
        article = soup.body or soup

    title = ""
    for sel in ["h1", "title"]:
        el = soup.find(sel)
        if el:
            title = el.get_text(strip=True)
            if title:
                break

    paragraphs = []
    for p in article.find_all(["p", "h1", "h2", "h3", "h4", "h5", "blockquote", "li"]):
        text = p.get_text(strip=True)
        if len(text) > 15:
            paragraphs.append({"tag": p.name, "text": text})

    return title, paragraphs[:60]


def call_ollama(prompt):
    """Call local Ollama for NER."""
    try:
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
            return None
        return resp.json().get("response", "")
    except Exception:
        return None


def call_gemini(prompt):
    """Escalate to Gemini Flash for low-confidence entities."""
    if not GEMINI_KEY:
        return None
    try:
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2048},
            },
            timeout=30,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        return parts[0].get("text", "") if parts else None
    except Exception:
        return None


def parse_entities_json(text):
    """Parse JSON array from LLM response, stripping markdown."""
    if not text:
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
            return entities
    except json.JSONDecodeError:
        # Try to find JSON array in response
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    return []


def extract_entities(full_text):
    """Extract entities using Ollama, escalate low-confidence to Gemini."""
    # Truncate to avoid overwhelming the model
    truncated = full_text[:4000]
    prompt = NER_PROMPT + truncated

    # Step 1: Local Ollama
    raw = call_ollama(prompt)
    entities = parse_entities_json(raw)

    if not entities:
        # Ollama failed entirely — try Gemini
        raw = call_gemini(prompt)
        entities = parse_entities_json(raw)
        for e in entities:
            e["source"] = "gemini"
        return entities

    # Step 2: Find low-confidence entities
    low_conf = [e for e in entities if e.get("confidence", 1.0) < CONFIDENCE_THRESHOLD]
    high_conf = [e for e in entities if e.get("confidence", 1.0) >= CONFIDENCE_THRESHOLD]

    # Step 3: Escalate low-confidence to Gemini
    if low_conf and GEMINI_KEY:
        low_texts = [e.get("text", "") for e in low_conf]
        escalation_prompt = f"""These entity extractions from a financial article have low confidence.
Verify each one and return ONLY a JSON array with corrected entities.
For each: {{"text": "...", "type": "ticker|company|person|sector|index", "ticker": "AAPL or null", "confidence": 0.0-1.0}}

Low confidence entities: {json.dumps(low_texts)}

Original text context:
{truncated[:2000]}"""

        raw = call_gemini(escalation_prompt)
        escalated = parse_entities_json(raw)
        for e in escalated:
            e["source"] = "gemini-escalated"
        high_conf.extend(escalated)
    else:
        # Keep low-confidence as-is if no Gemini
        high_conf.extend(low_conf)

    for e in high_conf:
        if "source" not in e:
            e["source"] = "ollama"

    return high_conf


def map_entities_to_paragraphs(paragraphs, entities):
    """Map extracted entities to character positions in each paragraph."""
    entity_lookup = {}
    for e in entities:
        text = e.get("text", "")
        if text:
            entity_lookup[text.lower()] = e

    for p in paragraphs:
        p_text = p["text"]
        p_lower = p_text.lower()
        p_entities = []

        for key, entity in entity_lookup.items():
            idx = p_lower.find(key)
            while idx >= 0:
                p_entities.append({
                    "type": entity.get("type", "company"),
                    "value": p_text[idx:idx + len(key)],
                    "ticker": entity.get("ticker"),
                    "start": idx,
                    "end": idx + len(key),
                    "confidence": entity.get("confidence", 0.5),
                })
                idx = p_lower.find(key, idx + len(key))

        # Deduplicate overlapping
        p_entities.sort(key=lambda e: (e["start"], -len(e["value"])))
        filtered = []
        last_end = 0
        for e in p_entities:
            if e["start"] >= last_end:
                filtered.append(e)
                last_end = e["end"]

        p["entities"] = filtered

    # Collect summary
    all_tickers = list(set(
        e.get("ticker") or e.get("value", "")
        for e in entities
        if e.get("type") == "ticker" and (e.get("ticker") or e.get("value"))
    ))
    all_companies = list(set(
        e.get("text", "") for e in entities if e.get("type") == "company"
    ))
    all_people = list(set(
        e.get("text", "") for e in entities if e.get("type") == "person"
    ))
    all_sectors = list(set(
        e.get("text", "") for e in entities if e.get("type") in ("sector", "index")
    ))

    return all_tickers, all_companies, all_people, all_sectors


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no URL provided"}))
        sys.exit(1)

    url = sys.argv[1]

    html, final_url = fetch_article(url)
    if html is None:
        print(json.dumps({"error": f"fetch failed: {final_url}", "url": url}))
        sys.exit(0)

    title, paragraphs = extract_content(html)

    if not paragraphs:
        print(json.dumps({
            "error": "no content extracted",
            "url": url, "title": title or "",
            "paragraphs": [],
        }))
        sys.exit(0)

    # Full text for entity extraction
    full_text = title + "\n" + "\n".join(p["text"] for p in paragraphs)

    # Extract entities via Ollama (+ Gemini escalation)
    entities = extract_entities(full_text)

    # Map entities to paragraph positions
    tickers, companies, people, sectors = map_entities_to_paragraphs(paragraphs, entities)

    result = {
        "title": title,
        "url": final_url,
        "paragraphs": paragraphs,
        "wordCount": sum(len(p["text"].split()) for p in paragraphs),
        "tickers": tickers,
        "companies": companies,
        "people": people,
        "sectors": sectors,
        "entityCount": len(entities),
        "bot": "Distinguished Reader Bot 9000",
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
