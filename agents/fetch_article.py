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
        start = time.time()
        try:
            html, final_url = fetcher(url)
        except Exception as e:
            log(f"  {name} exception: {e}")
            continue

        elapsed = time.time() - start

        if not html or len(html) < 500:
            log(f"  {name} returned no/short content ({len(html) if html else 0} bytes) in {elapsed:.1f}s")
            continue

        # Validate: does it have real text content?
        soup = BeautifulSoup(html, "html.parser")
        text = soup.get_text()
        text_len = len(text.strip())

        if text_len < 100:
            log(f"  {name} HTML ok ({len(html)} bytes) but text too short ({text_len} chars) in {elapsed:.1f}s")
            continue

        blockers = ["enable javascript", "enable js", "please turn javascript",
                     "browser doesn't support", "cookies are disabled"]
        if any(b in text.lower() for b in blockers):
            log(f"  {name} blocked by JS/cookie wall in {elapsed:.1f}s")
            continue

        log(f"  {name} success: {len(html)} bytes, {text_len} chars text in {elapsed:.1f}s")
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
                ".post-content", ".entry-content", ".story-body", ".article-content",
                ".caas-body", '[data-testid="article-body"]', "main"]:
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

    # Step 2: Extract text (no LLM — just HTML parsing)
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

    # Step 3: Return plain text — entity extraction done client-side via FMP search
    result = {
        "title": title,
        "url": url,
        "paragraphs": paragraphs,
        "wordCount": word_count,
        "strategy": strategy,
        "bot": "Distinguished Reader Bot 9000",
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
