#!/usr/bin/env python3
"""Serve Collage Cutter locally.

Sends the two "cross-origin isolation" headers, which let the AI features use all your CPU cores
(about 3x faster than opening index.html directly). Everything the page loads is either local or
from CDNs that allow this, so nothing else changes.
"""
import http.server
import os
import sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
