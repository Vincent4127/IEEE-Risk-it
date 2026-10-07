"""Runs the game on this computer at http://localhost:8000, with caching off,
so every refresh loads the latest files.

    python serve.py          (or: python serve.py 8080 for another port)
"""
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Risk It: http://localhost:{port}  (Ctrl + C to stop)")
    http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
