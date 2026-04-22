#!/usr/bin/env python3
"""Fetches a URL and extracts readable article content."""
import json
import sys
import requests
from bs4 import BeautifulSoup

def extract_article(url):
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Stocktopus Reader)"}
        resp = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove scripts, styles, nav, footer
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "iframe", "form"]):
            tag.decompose()

        # Try common article selectors
        article = None
        for selector in ["article", '[role="main"]', ".post-content", ".article-body", ".entry-content", ".story-body", "main"]:
            article = soup.select_one(selector)
            if article:
                break

        if not article:
            article = soup.body or soup

        # Extract paragraphs
        paragraphs = []
        for p in article.find_all(["p", "h1", "h2", "h3", "h4", "blockquote", "li"]):
            text = p.get_text(strip=True)
            if len(text) > 20:
                tag = p.name
                paragraphs.append({"tag": tag, "text": text})

        # Get title
        title = ""
        title_tag = soup.find("title")
        if title_tag:
            title = title_tag.get_text(strip=True)
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text(strip=True)

        return {
            "title": title,
            "paragraphs": paragraphs[:50],
            "url": url,
            "wordCount": sum(len(p["text"].split()) for p in paragraphs),
        }
    except Exception as e:
        return {"error": str(e), "url": url}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no URL provided"}))
        sys.exit(1)
    print(json.dumps(extract_article(sys.argv[1])))
