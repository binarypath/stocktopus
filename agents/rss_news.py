#!/usr/bin/env python3
"""RSS news agent — aggregates financial news from RSS feeds filtered by company."""

import json
import sys
import feedparser

# Major financial news RSS feeds
FEEDS = [
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US",
    "https://www.investing.com/rss/news.rss",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
]

def fetch_feed(url, symbol, max_items=5):
    """Fetch and filter an RSS feed for mentions of the symbol."""
    try:
        feed = feedparser.parse(url)
        results = []
        symbol_lower = symbol.lower()

        for entry in feed.entries[:20]:
            title = entry.get("title", "")
            summary = entry.get("summary", entry.get("description", ""))
            link = entry.get("link", "")

            # Check if entry mentions the symbol
            text = (title + " " + summary).lower()
            if symbol_lower in text or symbol.upper() in title:
                results.append({
                    "title": title,
                    "summary": summary[:300] if summary else "",
                    "url": link,
                    "published": entry.get("published", ""),
                    "source": feed.feed.get("title", url),
                })

            if len(results) >= max_items:
                break

        return results
    except Exception as e:
        return [{"error": str(e), "feed": url}]

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no symbol provided"}))
        sys.exit(1)

    symbol = sys.argv[1]
    all_articles = []
    sources = []

    for feed_url in FEEDS:
        url = feed_url.format(symbol=symbol)
        articles = fetch_feed(url, symbol)
        for a in articles:
            if "error" not in a:
                all_articles.append(a)
                if a.get("url"):
                    sources.append(a["url"])

    output = {
        "symbol": symbol,
        "source": "rss_news",
        "articles": all_articles,
        "sources": sources,
        "article_count": len(all_articles),
    }

    print(json.dumps(output))

if __name__ == "__main__":
    main()
