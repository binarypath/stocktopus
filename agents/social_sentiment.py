#!/usr/bin/env python3
"""Social sentiment agent — gathers public social media mentions via Bluesky AT Protocol."""

import json
import sys
import requests

BSKY_SEARCH = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts"

def search_bluesky(query, limit=10):
    """Search Bluesky public posts."""
    try:
        resp = requests.get(
            BSKY_SEARCH,
            params={"q": query, "limit": limit, "sort": "latest"},
            timeout=10,
        )
        if resp.status_code != 200:
            return []

        data = resp.json()
        posts = []
        for post in data.get("posts", []):
            record = post.get("record", {})
            author = post.get("author", {})
            posts.append({
                "text": record.get("text", ""),
                "author": author.get("handle", ""),
                "displayName": author.get("displayName", ""),
                "createdAt": record.get("createdAt", ""),
                "likes": post.get("likeCount", 0),
                "reposts": post.get("repostCount", 0),
            })
        return posts
    except Exception as e:
        return [{"error": str(e)}]

def simple_sentiment(text):
    """Very basic keyword sentiment scoring."""
    positive = ["bullish", "buy", "growth", "strong", "beat", "upgrade", "positive",
                "opportunity", "momentum", "outperform", "breakout", "surge"]
    negative = ["bearish", "sell", "decline", "weak", "miss", "downgrade", "negative",
                "risk", "crash", "underperform", "drop", "warning"]

    text_lower = text.lower()
    pos = sum(1 for w in positive if w in text_lower)
    neg = sum(1 for w in negative if w in text_lower)
    total = pos + neg
    if total == 0:
        return 0
    return (pos - neg) / total

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no symbol provided"}))
        sys.exit(1)

    symbol = sys.argv[1]

    # Search with different queries
    queries = [f"${symbol}", f"{symbol} stock"]
    all_posts = []

    for query in queries:
        posts = search_bluesky(query)
        for p in posts:
            if "error" not in p:
                all_posts.append(p)

    # Compute aggregate sentiment
    sentiments = [simple_sentiment(p["text"]) for p in all_posts if p.get("text")]
    avg_sentiment = sum(sentiments) / len(sentiments) if sentiments else 0

    # Top posts by engagement
    all_posts.sort(key=lambda p: p.get("likes", 0) + p.get("reposts", 0), reverse=True)

    output = {
        "symbol": symbol,
        "source": "social_sentiment",
        "platform": "bluesky",
        "posts": all_posts[:10],
        "aggregateSentiment": round(avg_sentiment, 3),
        "postCount": len(all_posts),
        "sources": ["https://bsky.app"],
    }

    print(json.dumps(output))

if __name__ == "__main__":
    main()
