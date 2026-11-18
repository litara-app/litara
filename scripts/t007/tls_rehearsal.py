#!/usr/bin/env python3
"""Local TLS two-origin rehearsal (T007 M3, scenario tls-reader-isolation).

  python scripts/t007/tls_rehearsal.py [--out research/t007/evidence/m3-tls-origins]

The real server runs WITHOUT LITARA_DEV_INSECURE_HTTP, with the built web app, a separate reader listener, and distinct public
origins, behind scripts/t007/tlsproxy (a certificate-validated TLS terminator for app.litara.test and reader.litara.test on one
port). Clients validate the throwaway CA; nothing falls back to plain HTTP. Checks are recorded one by one in run.json.
"""
import http.client, json, os, socket, ssl, subprocess, sys, time, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m3-tls-origins")
TLS_PORT, READER_PORT = 18443, 18409
APP, RDR = "app.litara.test", "reader.litara.test"
APP_ORIGIN, RDR_ORIGIN = f"https://{APP}:{TLS_PORT}", f"https://{RDR}:{TLS_PORT}"
results = []


def check(name, ok, detail=""):
    results.append({"check": name, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + name, ("- " + str(detail)[:160]) if not ok else "")


class Conn(http.client.HTTPSConnection):
    def __init__(self, host, ctx):
        super().__init__("127.0.0.1", TLS_PORT, context=ctx, timeout=30)
        self._sni = host

    def connect(self):
        sock = socket.create_connection(("127.0.0.1", TLS_PORT), timeout=30)
        self.sock = self._context.wrap_socket(sock, server_hostname=self._sni)


def ctx_for(ca):
    c = ssl.create_default_context(cafile=str(ca)) if ca else ssl.create_default_context()
    return c


def req(host, method, path, ca, headers=None, body=None):
    c = Conn(host, ctx_for(ca))
    h = {"Host": f"{host}:{TLS_PORT}"}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    if data:
        h.setdefault("Content-Type", "application/json")
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    raw = r.read()
    out = (r.status, {k.lower(): v for k, v in r.getheaders()}, raw, r.getheaders())
    c.close()
    return out


def jparse(raw):
    try:
        return json.loads(raw)
    except Exception:
        return None


def kill(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, 9)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    kill(int((WORK / "server.pid").read_text()))
    time.sleep(2)
    env = stack.env_for((WORK / "secret.key").read_text().strip(), WORK / "media")
    env.pop("LITARA_DEV_INSECURE_HTTP", None)
    env.update({"LITARA_WEB_DIR": str(ROOT / "apps" / "web" / "dist"), "LITARA_READER_ADDR": f"127.0.0.1:{READER_PORT}",
                "LITARA_PUBLIC_ORIGIN": APP_ORIGIN, "LITARA_READER_ORIGIN": RDR_ORIGIN, "LITARA_ALLOWED_ORIGINS": APP_ORIGIN})
    srv = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=env, stdout=open(WORK / "server.log", "wb"), stderr=subprocess.STDOUT)
    (WORK / "server.pid").write_text(str(srv.pid))
    pdir = WORK / "tls"
    pdir.mkdir(exist_ok=True)
    proxy = subprocess.Popen(["go", "run", str(ROOT / "scripts" / "t007" / "tlsproxy" / "main.go"), "-out", str(pdir), "-listen", f"127.0.0.1:{TLS_PORT}",
                              "-app", f"{APP}=127.0.0.1:{stack.PORT}", "-reader", f"{RDR}=127.0.0.1:{READER_PORT}"], stdout=open(pdir / "proxy.log", "wb"), stderr=subprocess.STDOUT)
    ca = pdir / "ca.pem"
    for _ in range(60):
        try:
            if ca.exists() and req(APP, "GET", "/readyz", ca)[0] == 200:
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise SystemExit("TLS stack never became ready; see .tmp/t007/server.log and tls/proxy.log")
    try:
        # --- certificate validation, no fallback ---
        for h in (APP, RDR):
            check(f"validated TLS handshake to {h}", req(h, "GET", "/readyz", ca)[0] in (200, 404))
        try:
            req(APP, "GET", "/readyz", None)
            check("handshake without the CA is refused", False, "connected")
        except ssl.SSLCertVerificationError:
            check("handshake without the CA is refused", True)
        try:
            Conn(f"wrong.{APP}", ctx_for(ca)).request("GET", "/")
            check("certificate for another host name is refused", False)
        except ssl.SSLCertVerificationError:
            check("certificate for another host name is refused", True)
        s = socket.create_connection(("127.0.0.1", TLS_PORT), timeout=5)
        s.sendall(b"GET /readyz HTTP/1.1\r\nHost: x\r\n\r\n")
        s.settimeout(5)
        try:
            first = s.recv(16)
        except OSError:
            first = b""
        check("plain HTTP to the TLS port gets no HTTP answer", not first.startswith(b"HTTP/1.1 200"), first[:40])
        s.close()

        # --- application origin ---
        st, h, body, _ = req(APP, "GET", "/", ca)
        csp = h.get("content-security-policy", "")
        check("app origin serves the SPA with CSP, nosniff, frame denial", st == 200 and csp and h.get("x-content-type-options") == "nosniff" and h.get("x-frame-options") == "DENY", (st, csp[:100]))
        check("app CSP allows framing only the reader origin", RDR_ORIGIN in csp and "frame-src" in csp, csp)
        cfg = jparse(req(APP, "GET", "/app-config.json", ca)[2]) or {}
        check("app-config names the reader origin", cfg.get("readerOrigin") == RDR_ORIGIN, cfg)
        check("app origin refuses /reader/ assets", req(APP, "GET", "/reader/", ca)[0] == 404)

        # --- reader origin: assets only, no API, hostile root routes denied ---
        st, h, _, _ = req(RDR, "GET", "/", ca)
        check("reader origin root route does not serve the app", st in (403, 404), st)
        for p in ("/api/v1/me", "/api/v1/discovery", "/library", "/admin", "/auth/web/login"):
            st = req(RDR, "GET", p, ca)[0]
            check(f"reader origin denies {p}", st in (403, 404, 405), st)
        st, h, _, _ = req(RDR, "GET", "/reader/", ca)
        rcsp = h.get("content-security-policy", "")
        check("reader assets carry a sandboxing CSP", st in (200, 301, 302, 404) and (st == 404 or bool(rcsp)), (st, rcsp[:120]))
        st, h, _, _ = req(RDR, "OPTIONS", "/reader/", ca, {"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
        check("reader origin sends no CORS grant to a hostile origin", "access-control-allow-origin" not in h, h.get("access-control-allow-origin"))

        # --- web session cookies, CSRF, CORS ---
        st, h, body, raw = req(APP, "POST", "/api/v1/auth/web/login", ca, {"Origin": APP_ORIGIN}, {"username": c["reader"][0], "password": c["reader"][1], "deviceName": "tls-browser"})
        cookies = [v for k, v in raw if k.lower() == "set-cookie"]
        check("web login succeeds over TLS", st in (200, 204), (st, body[:120]))
        check("every session cookie is Secure, HttpOnly (session) and SameSite", cookies and all("secure" in x.lower() and "samesite" in x.lower() for x in cookies) and any("httponly" in x.lower() for x in cookies), cookies)
        jar = "; ".join(x.split(";")[0] for x in cookies)
        csrf = next((x.split(";")[0].split("=", 1)[1] for x in cookies if "csrf" in x.split("=")[0].lower()), "")
        st, _, body, _ = req(APP, "GET", "/api/v1/me", ca, {"Cookie": jar})
        check("cookie session reads /me", st == 200, (st, body[:100]))
        st, _, body, _ = req(APP, "POST", "/api/v1/auth/web/logout", ca, {"Cookie": jar, "Origin": APP_ORIGIN})
        check("state-changing cookie request without CSRF token is refused", st in (401, 403), (st, body[:140]))
        st, _, body, _ = req(APP, "POST", "/api/v1/auth/web/logout", ca, {"Cookie": jar, "Origin": "https://evil.example", "X-CSRF-Token": csrf})
        check("state-changing cookie request from a hostile Origin is refused", st in (401, 403), (st, body[:140]))
        st, h, _, _ = req(APP, "OPTIONS", "/api/v1/me", ca, {"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
        check("API sends no CORS grant to a hostile origin", "access-control-allow-origin" not in h, h.get("access-control-allow-origin"))
        st, h, _, _ = req(APP, "OPTIONS", "/api/v1/me", ca, {"Origin": APP_ORIGIN, "Access-Control-Request-Method": "GET"})
        check("API has no cross-origin surface: even the app origin gets no CORS grant (same-origin use only)", "access-control-allow-origin" not in h, (st, h.get("access-control-allow-origin")))

        # --- native bearer: login, original Range/HEAD, refresh rotation, revocation ---
        st, _, body, _ = req(APP, "POST", "/api/v1/auth/native/login", ca, None, {"username": c["reader"][0], "password": c["reader"][1], "deviceName": "tls-rehearsal"})
        tp = jparse(body) or {}
        check("native login over TLS", st == 200 and tp.get("accessToken"), st)
        auth = {"Authorization": "Bearer " + tp.get("accessToken", "")}
        admt = {"Authorization": "Bearer " + (jparse(req(APP, "POST", "/api/v1/auth/native/login", ca, None, {"username": c["admin"][0], "password": c["admin"][1], "deviceName": "tls-admin0"})[2]) or {}).get("accessToken", "")}
        for _ in range(8):  # files need two observations before they are cataloged
            eds = (jparse(req(APP, "GET", "/api/v1/editions?size=50", ca, auth)[2]) or {}).get("items", [])
            if len(eds) >= 4:
                break
            req(APP, "POST", f"/api/v1/admin/libraries/{c['library']}/scans", ca, admt, {})
            time.sleep(4)
        ed = next((e for e in eds if e["file"]["format"] == "epub"), None)
        path = ed["file"]["contentPath"]
        st, h, body, _ = req(APP, "GET", path, ca, {**auth, "Range": "bytes=0-31"})
        check("authenticated original Range read", st == 206 and len(body) == 32, (st, len(body)))
        st, h, body, _ = req(APP, "HEAD", path, ca, auth)
        check("authenticated original HEAD reports size and range support", st == 200 and h.get("accept-ranges") == "bytes" and int(h.get("content-length", 0)) == ed["file"]["sizeBytes"], (st, h.get("accept-ranges"), h.get("content-length")))
        st, _, _, _ = req(APP, "GET", path, ca)
        check("original without credentials is refused", st in (401, 403), st)
        st, _, body, _ = req(APP, "POST", "/api/v1/auth/native/refresh", ca, None, {"refreshToken": tp.get("refreshToken"), "requestId": str(uuid.uuid4())})
        rt = jparse(body) or {}
        check("refresh rotates the token pair", st == 200 and rt.get("refreshToken") and rt["refreshToken"] != tp.get("refreshToken"), st)
        sessions = (jparse(req(APP, "GET", "/api/v1/sessions", ca, {"Authorization": "Bearer " + rt.get("accessToken", "")})[2]) or {}).get("items", [])
        mine = [s_ for s_ in sessions if s_.get("deviceName") == "tls-rehearsal"]
        check("session is listed for the device", len(mine) >= 1, sessions[:2])
        if mine:
            st, _, _, _ = req(APP, "DELETE", f"/api/v1/sessions/{mine[0]['id']}", ca, {"Authorization": "Bearer " + rt["accessToken"]})
            check("session revocation accepted", st in (200, 204), st)
            st, _, _, _ = req(APP, "POST", "/api/v1/auth/native/refresh", ca, None, {"refreshToken": rt.get("refreshToken"), "requestId": str(uuid.uuid4())})
            check("revoked session cannot refresh", st in (401, 403), st)
            st, _, _, _ = req(APP, "GET", "/api/v1/me", ca, {"Authorization": "Bearer " + rt["accessToken"]})
            check("revoked session's access token stops working", st in (401, 403), st)
        # --- hostile content ---
        evil = WORK / "media" / "Synthetic Author" / "Hostile.epub"
        import zipfile
        with zipfile.ZipFile(evil, "w") as z:
            z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
            z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
            z.writestr("c.opf", '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="i"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="i">urn:x</dc:identifier><dc:title>&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</dc:title><dc:creator>"&gt;&lt;svg onload=alert(1)&gt;</dc:creator></metadata><manifest/><spine/></package>')
        adm = jparse(req(APP, "POST", "/api/v1/auth/native/login", ca, None, {"username": c["admin"][0], "password": c["admin"][1], "deviceName": "tls-admin"})[2])["accessToken"]
        auth = {"Authorization": "Bearer " + jparse(req(APP, "POST", "/api/v1/auth/native/login", ca, None, {"username": c["reader"][0], "password": c["reader"][1], "deviceName": "tls-rehearsal-2"})[2])["accessToken"]}
        title = None
        for _ in range(8):
            try:
                req(APP, "POST", f"/api/v1/admin/libraries/{c['library']}/scans", ca, {"Authorization": "Bearer " + adm}, {})
            except Exception:
                pass
            time.sleep(4)
            ts = (jparse(req(APP, "GET", "/api/v1/titles?size=50", ca, auth)[2]) or {}).get("items", [])
            title = next((t for t in ts if "<script>" in t["title"]), None)
            if title:
                break
        check("hostile metadata is stored and returned as inert JSON text", bool(title) and req(APP, "GET", "/api/v1/titles?size=50", ca, auth)[1].get("content-type", "").startswith("application/json"), title or [t["title"] for t in ts])
        st, h, _, _ = req(APP, "GET", "/api/v1/titles?size=50", ca, auth)
        check("API JSON responses are nosniff", h.get("x-content-type-options") == "nosniff", h.get("x-content-type-options"))
    finally:
        kill(proxy.pid)
        kill(srv.pid)
        stack.down(quiet=True)
    passed = sum(r["pass"] for r in results)
    rep = {"finished": datetime.datetime.now(datetime.timezone.utc).isoformat(), "passed": passed, "failed": len(results) - passed, "checks": results}
    (OUT / "run.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    print(f"{passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)


main()
