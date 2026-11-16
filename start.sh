#!/usr/bin/env bash
# Serve Collage Cutter on http://localhost:8765 and open it in your browser.
# (Opening index.html directly also works; serving it this way makes the AI features ~3x faster.)
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
URL="http://localhost:$PORT/"
( sleep 0.7; xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 ) &
echo "Collage Cutter running at $URL  (Ctrl+C to stop)"
exec python3 serve.py "$PORT"
