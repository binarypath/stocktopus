#!/usr/bin/env python3
"""SEC EDGAR agent — fetches recent SEC filings for a company."""

import json
import sys
import requests

EDGAR_SEARCH = "https://efts.sec.gov/LATEST/search-index?q=%22{company}%22&dateRange=custom&startdt=2025-01-01&forms=10-K,10-Q,8-K&hits.hits.total=5"
EDGAR_COMPANY = "https://data.sec.gov/submissions/CIK{cik}.json"

# Common CIK lookups (extend as needed)
CIK_MAP = {
    "AAPL": "0000320193",
    "MSFT": "0000789019",
    "GOOGL": "0001652044",
    "AMZN": "0001018724",
    "META": "0001326801",
    "TSLA": "0001318605",
    "NVDA": "0001045810",
    "JPM": "0000019617",
}

HEADERS = {
    "User-Agent": "Stocktopus Research Agent research@stocktopus.dev",
    "Accept": "application/json",
}

def fetch_filings(symbol):
    """Fetch recent SEC filings from EDGAR."""
    cik = CIK_MAP.get(symbol.upper())
    if not cik:
        return {"filings": [], "note": f"CIK not found for {symbol}, skipping SEC lookup"}

    try:
        url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            return {"error": f"EDGAR returned {resp.status_code}"}

        data = resp.json()
        recent = data.get("filings", {}).get("recent", {})

        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        descriptions = recent.get("primaryDocument", [])
        accessions = recent.get("accessionNumber", [])

        filings = []
        target_forms = {"10-K", "10-Q", "8-K", "10-K/A", "10-Q/A"}

        for i in range(min(len(forms), 20)):
            if forms[i] in target_forms:
                accession_clean = accessions[i].replace("-", "")
                filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_clean}/{descriptions[i]}"
                filings.append({
                    "form": forms[i],
                    "date": dates[i],
                    "document": descriptions[i],
                    "url": filing_url,
                })
            if len(filings) >= 5:
                break

        return {
            "companyName": data.get("name", ""),
            "cik": cik,
            "filings": filings,
        }

    except Exception as e:
        return {"error": str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no symbol provided"}))
        sys.exit(1)

    symbol = sys.argv[1]
    result = fetch_filings(symbol)

    output = {
        "symbol": symbol,
        "source": "sec_filings",
        "sources": [f.get("url", "") for f in result.get("filings", [])],
        **result,
    }

    print(json.dumps(output))

if __name__ == "__main__":
    main()
