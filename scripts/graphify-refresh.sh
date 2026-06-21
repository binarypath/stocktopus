#!/bin/sh
# Rebuild the local graphify knowledge graph + MCP search index.
# Output goes to graphify-out/ (gitignored). Run when architecture questions
# need fresh context — not on every commit.
set -e
cd "$(git rev-parse --show-toplevel)"

command -v graphify >/dev/null 2>&1 || {
    echo "graphify not found — install: uv tool install graphifyy" >&2
    exit 1
}

echo "[graphify] Updating graph (AST only)..."
graphify update .

if command -v npx >/dev/null 2>&1; then
    echo "[graphify] Refreshing MCP search index..."
    npx -y graphify-mcp-tools index --graph ./graphify-out
fi

echo "[graphify] Done — see graphify-out/GRAPH_REPORT.md"
