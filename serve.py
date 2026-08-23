#!/usr/bin/env python3
"""Tiny static server for the Data Flywheel lab.

Serves the app with no-cache headers so the browser always picks up the
latest JS/CSS on refresh — no more stale-cache confusion during development.

Usage:
    python3 serve.py            # serves on http://localhost:8777
    python3 serve.py 9000       # custom port
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    print(f"Data Flywheel lab → http://localhost:{port}  (Ctrl+C to stop)")
    HTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
