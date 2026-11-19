#!/usr/bin/env python3
"""Logging forwarder for user-assisted client sessions (T007): listens on one port, forwards to the real server, and logs one line per
request WITHOUT any secret: method, path (credential-looking path segments are not present in these APIs), status, response
Content-Type, the NAMES of the request headers, and the first 120 bytes of an error body. Used between tlsproxy and the server.

  python scripts/t007/http_tap.py LISTEN_PORT BACKEND_PORT LOGFILE
"""
import http.client, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN, BACKEND, LOG = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
lock = threading.Lock()
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        c = http.client.HTTPConnection("127.0.0.1", BACKEND, timeout=60)
        hdrs = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        c.request(self.command, self.path, body=body, headers=hdrs)
        r = c.getresponse()
        data = r.read()
        names = ",".join(sorted(k.lower() for k in self.headers.keys()))
        err = data[:120].decode("utf-8", "replace").replace("\n", " ") if r.status >= 400 else ""
        with lock, open(LOG, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%H:%M:%S')} {self.command} {self.path.split('?')[0][:80]} -> {r.status} ct={r.getheader('Content-Type')} req-headers=[{names}] bodylen={n} {err}\n")
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() not in HOP and k.lower() != "content-length":
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    do_GET = do_PUT = do_POST = do_DELETE = do_HEAD = do_OPTIONS = do_PATCH = do


ThreadingHTTPServer(("127.0.0.1", LISTEN), H).serve_forever()
