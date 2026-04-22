#!/usr/bin/env python3
"""Distinguished Reader Bot 9000 — fetches, extracts, and enriches articles."""
import json
import os
import re
import sys
import requests
from bs4 import BeautifulSoup

# Full Chrome browser headers to bypass JS/ad-blocker walls
CHROME_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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

# Common ticker patterns
TICKER_RE = re.compile(r'\b([A-Z]{1,5})\b')

# Known major tickers for entity matching
MAJOR_TICKERS = {
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "NVDA", "JPM",
    "V", "MA", "DIS", "NFLX", "PYPL", "INTC", "AMD", "CRM", "ORCL", "CSCO",
    "QCOM", "AVGO", "TXN", "MU", "AMAT", "KLAC", "LRCX", "ASML", "TSM",
    "BA", "GE", "CAT", "MMM", "HD", "WMT", "COST", "TGT", "NKE", "SBUX",
    "KO", "PEP", "MCD", "PG", "JNJ", "PFE", "UNH", "ABBV", "MRK", "LLY",
    "BAC", "WFC", "GS", "MS", "C", "BLK", "SCHW", "AXP",
    "XOM", "CVX", "COP", "SLB", "EOG", "BRK", "SPY", "QQQ", "IWM", "DIA",
    "SNAP", "PINS", "RDDT", "PLTR", "RIVN", "LCID", "NIO", "SOFI", "COIN",
    "DJT", "GME", "AMC", "BBBY", "HOOD", "RBLX", "U", "DDOG", "SNOW",
}

# Common financial/sector terms
SECTOR_TERMS = {
    "technology", "healthcare", "financial", "energy", "consumer", "industrial",
    "materials", "utilities", "real estate", "communication", "semiconductor",
    "artificial intelligence", "AI", "machine learning", "cloud computing",
    "electric vehicle", "EV", "cryptocurrency", "bitcoin", "blockchain",
    "federal reserve", "Fed", "interest rate", "inflation", "GDP", "earnings",
    "revenue", "profit", "dividend", "IPO", "merger", "acquisition", "SEC",
    "S&P 500", "Nasdaq", "Dow Jones", "Russell 2000",
}


def fetch_article(url):
    """Fetch article with full browser impersonation."""
    session = requests.Session()
    session.headers.update(CHROME_HEADERS)

    try:
        # Follow redirects, handle cookies
        resp = session.get(url, timeout=15, allow_redirects=True)
        resp.raise_for_status()
        return resp.text, resp.url
    except Exception as e:
        return None, str(e)


def extract_content(html, url):
    """Extract article text from HTML."""
    soup = BeautifulSoup(html, "html.parser")

    # Remove noise
    for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                     "iframe", "form", "noscript", "svg", "button", "input"]):
        tag.decompose()

    # Remove common ad/tracking divs
    for cls in ["ad", "advertisement", "social-share", "newsletter", "popup",
                "modal", "cookie", "banner", "sidebar", "related-articles"]:
        for el in soup.find_all(class_=re.compile(cls, re.I)):
            el.decompose()

    # Find article body
    article = None
    for selector in [
        "article", '[role="main"]', ".article-body", ".article__body",
        ".post-content", ".entry-content", ".story-body", ".article-content",
        ".caas-body", ".paywall", '[data-testid="article-body"]',
        ".article__content", ".article-text", "main",
    ]:
        article = soup.select_one(selector)
        if article:
            break

    if not article:
        article = soup.body or soup

    # Get title
    title = ""
    for sel in ["h1", "title"]:
        el = soup.find(sel)
        if el:
            title = el.get_text(strip=True)
            if title:
                break

    # Extract paragraphs
    paragraphs = []
    for p in article.find_all(["p", "h1", "h2", "h3", "h4", "h5", "blockquote", "li"]):
        text = p.get_text(strip=True)
        if len(text) > 15:
            paragraphs.append({"tag": p.name, "text": text})

    return title, paragraphs[:60]


def enrich_text(text):
    """Find and annotate entities in text: tickers, people, sectors."""
    entities = []

    # Find ticker mentions
    for match in TICKER_RE.finditer(text):
        word = match.group(1)
        if word in MAJOR_TICKERS:
            entities.append({
                "type": "ticker",
                "value": word,
                "start": match.start(),
                "end": match.end(),
            })

    # Find sector terms
    text_lower = text.lower()
    for term in SECTOR_TERMS:
        idx = text_lower.find(term.lower())
        while idx >= 0:
            entities.append({
                "type": "sector",
                "value": term,
                "start": idx,
                "end": idx + len(term),
            })
            idx = text_lower.find(term.lower(), idx + len(term))

    # Deduplicate overlapping entities (prefer tickers)
    entities.sort(key=lambda e: (e["start"], -len(e["value"])))
    filtered = []
    last_end = 0
    for e in entities:
        if e["start"] >= last_end:
            filtered.append(e)
            last_end = e["end"]

    return filtered


def enrich_paragraphs(paragraphs):
    """Add entity annotations to each paragraph."""
    all_tickers = set()
    all_sectors = set()

    for p in paragraphs:
        entities = enrich_text(p["text"])
        p["entities"] = entities
        for e in entities:
            if e["type"] == "ticker":
                all_tickers.add(e["value"])
            elif e["type"] == "sector":
                all_sectors.add(e["value"])

    return list(all_tickers), list(all_sectors)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no URL provided"}))
        sys.exit(1)

    url = sys.argv[1]

    html, final_url = fetch_article(url)
    if html is None:
        print(json.dumps({"error": f"fetch failed: {final_url}", "url": url}))
        sys.exit(0)

    title, paragraphs = extract_content(html, final_url)

    if not paragraphs:
        print(json.dumps({
            "error": "no content extracted",
            "url": url,
            "title": title or "",
            "paragraphs": [],
        }))
        sys.exit(0)

    tickers, sectors = enrich_paragraphs(paragraphs)

    result = {
        "title": title,
        "url": final_url,
        "paragraphs": paragraphs,
        "wordCount": sum(len(p["text"].split()) for p in paragraphs),
        "tickers": tickers,
        "sectors": sectors,
        "bot": "Distinguished Reader Bot 9000",
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
