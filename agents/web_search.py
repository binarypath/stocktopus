#!/usr/bin/env python3
"""Web search agent — searches DuckDuckGo for company info and summarizes results."""

import json
import sys
import requests
from bs4 import BeautifulSoup

def search_ddg(query, num_results=5):
    """Search DuckDuckGo and return results."""
    url = "https://html.duckduckgo.com/html/"
    headers = {"User-Agent": "Mozilla/5.0 (Stocktopus Research Agent)"}

    try:
        resp = requests.post(url, data={"q": query}, headers=headers, timeout=10)
        soup = BeautifulSoup(resp.text, "html.parser")

        results = []
        for r in soup.select(".result__body")[:num_results]:
            title_el = r.select_one(".result__title")
            snippet_el = r.select_one(".result__snippet")
            link_el = r.select_one(".result__url")

            results.append({
                "title": title_el.get_text(strip=True) if title_el else "",
                "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
                "url": link_el.get_text(strip=True) if link_el else "",
            })
        return results
    except Exception as e:
        return [{"error": str(e)}]

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no symbol provided"}))
        sys.exit(1)

    symbol = sys.argv[1]

    queries = [
        f"{symbol} stock analysis 2026",
        f"{symbol} company risks opportunities",
        f"{symbol} earnings outlook",
    ]

    all_results = []
    sources = []

    for query in queries:
        results = search_ddg(query)
        for r in results:
            if "error" not in r:
                all_results.append(r)
                if r.get("url"):
                    sources.append(r["url"])

    output = {
        "symbol": symbol,
        "source": "web_search",
        "results": all_results,
        "sources": sources,
        "query_count": len(queries),
        "result_count": len(all_results),
    }

    print(json.dumps(output))

if __name__ == "__main__":
    main()
