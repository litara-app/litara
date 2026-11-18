#!/usr/bin/env python3
"""User-assisted KOReader + OPDS session over real TLS (T007 M4, scenarios koreader-app and opds-conformance).

  python scripts/t007/koreader_session.py --ip 192.168.1.9 [--self-test] [--minutes 90]

Starts the disposable stack with the server bound to 127.0.0.1 only (plain HTTP never leaves this machine), a throwaway-CA TLS
proxy (scripts/t007/tlsproxy) on 0.0.0.0:18443 with the given IP as a certificate name, OPDS and KOReader integrations enabled and one
synthetic OPDS credential plus one synthetic KOReader credential for the synthetic reader. The synthetic secrets and the steps for the
tester are written to .tmp/t007/koreader-session.md (git-ignored; disposable accounts on a disposable database).

While the tester works the script records, every 15 s and without any secret, the server-side state KOReader should change:
canonical KOReader positions and revisions per edition, retained candidates/conflicts, and the web position (which must not change).
With --self-test it instead checks the TLS endpoints from this machine with the generated CA and exits.
"""
import base64, hashlib, json, os, ssl, subprocess, sys, time, urllib.request, urllib.error, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
arg = lambda n, d=None: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d  # noqa: E731
IP = arg("--ip", "127.0.0.1")
MINUTES = int(arg("--minutes", "90"))
SELF = "--self-test" in sys.argv
OUT = ROOT / "research/t007/evidence/m4-koreader"
PORT = 18443
BASE = f"https://{IP}:{PORT}"


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def kill(pid):
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def tls_get(path, ctx, headers=None, method="GET"):
    req = urllib.request.Request(BASE + path, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
            return r.status, dict((k.lower(), v) for k, v in r.getheaders()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict((k.lower(), v) for k, v in e.headers.items()), e.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    kill(int((WORK / "server.pid").read_text()))
    time.sleep(2)
    env = stack.env_for((WORK / "secret.key").read_text().strip(), WORK / "media")
    env.pop("LITARA_DEV_INSECURE_HTTP", None)
    env.update({"LITARA_HTTP_ADDR": f"127.0.0.1:{stack.PORT}", "LITARA_PUBLIC_ORIGIN": BASE, "LITARA_ALLOWED_ORIGINS": BASE})
    srv = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=env, stdout=open(WORK / "server.log", "ab"), stderr=subprocess.STDOUT)
    (WORK / "server.pid").write_text(str(srv.pid))
    pdir = WORK / "tls"
    pdir.mkdir(exist_ok=True)
    (pdir / "ca.pem").unlink(missing_ok=True)
    backend = f"127.0.0.1:{stack.PORT}"
    proxy = subprocess.Popen(["go", "run", str(ROOT / "scripts/t007/tlsproxy/main.go"), "-out", str(pdir), "-listen", f"0.0.0.0:{PORT}", "-ip", f"{IP},127.0.0.1",
                              "-app", f"litara.test={backend}", "-default", f"litara.test={backend}"], stdout=open(pdir / "proxy.log", "wb"), stderr=subprocess.STDOUT)
    http_ok = False
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{stack.PORT}/readyz", timeout=2).read()
            http_ok = (pdir / "ca.pem").exists()
            if http_ok:
                break
        except Exception:  # noqa: BLE001
            pass
        time.sleep(1)
    if not http_ok:
        raise SystemExit("server or proxy did not start; see .tmp/t007/server.log and tls/proxy.log")
    ctx = ssl.create_default_context(cafile=str(pdir / "ca.pem"))
    try:
        adm = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "ko-session-a"})["accessToken"]
        rt = stack.api("POST", "/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "ko-session-r"})["accessToken"]
        for _ in range(8):
            eds = stack.api("GET", "/editions?size=50", rt)["items"]
            if len(eds) >= 4:
                break
            try:
                stack.api("POST", f"/admin/libraries/{c['library']}/scans", adm, {})
            except SystemExit:
                pass
            time.sleep(4)
        ist = stack.api("GET", "/integrations/settings", adm)
        stack.api("PUT", "/admin/integrations/settings", adm, {"operationId": str(uuid.uuid4()), "baseRevision": ist["revision"], "opdsEnabled": True, "emailEnabled": ist["emailEnabled"],
                  "koreaderEnabled": True, "maxAttachmentBytes": ist["maxAttachmentBytes"], "maxDeliveriesPerUserPerHour": ist["maxDeliveriesPerUserPerHour"]})
        creds = {}
        for kind in ("opds", "koreader"):
            pw = uuid.uuid4().hex + uuid.uuid4().hex
            r = stack.api("POST", "/integration-credentials", rt, {"operationId": str(uuid.uuid4()), "kind": kind, "label": "t007-session-" + kind, "password": pw})
            creds[kind] = (r["username"], pw)
        titles = {t["id"]: t["title"] for t in stack.api("GET", "/titles?size=50", rt)["items"]}
        books = {titles[e["titleId"]]: e for e in eds}
        ou, op = creds["opds"]
        if SELF:
            auth = base64.b64encode(f"{ou}:{op}".encode()).decode()
            st, h, b = tls_get("/opds/v1", ctx, {"Authorization": "Basic " + auth})
            print("OPDS root over TLS:", st, h.get("content-type"))
            st2, _, b2 = tls_get("/opds/v1", ctx)
            print("OPDS without credentials:", st2)
            ku, kp = creds["koreader"]
            st3, _, b3 = tls_get("/1/users/auth", ctx, {"x-auth-user": ku, "x-auth-key": hashlib.md5(kp.encode()).hexdigest(), "Accept": "application/vnd.koreader.v1+json"})
            print("KOReader auth over TLS:", st3, b3[:60])
            try:
                tls_get("/opds/v1", ssl.create_default_context())
                print("default trust store accepted the cert (unexpected)")
            except (ssl.SSLError, urllib.error.URLError) as e:
                print("default trust store refuses the cert (expected):", type(e).__name__)
            ok = st == 200 and st2 == 401 and st3 == 200
            print("SELF-TEST", "OK" if ok else "FAILED")
            return 0 if ok else 1
        ku, kp = creds["koreader"]
        ca = (pdir / "ca.pem").resolve()
        (WORK / "koreader-session.md").write_text(f"""# KOReader + OPDS test session (synthetic, disposable)

Server: {BASE}   (certificate signed by the throwaway CA below; valid for {IP} and 127.0.0.1)
CA certificate to trust: {ca}

OPDS (KOReader: top menu > Search > OPDS catalog > + )
  Catalog URL : {BASE}/opds/v1          (OPDS 1.x Atom; v2 JSON is at {BASE}/opds/v2)
  Username    : {ou}
  Password    : {op}

Progress sync (KOReader: Tools > Progress sync > Custom sync server)
  Custom sync server : {BASE}
  Username           : {ku}
  Password           : {kp}
  (do not use Register; the server refuses account creation. Use Login.)

Books in the library: {', '.join(sorted(books))}
""", encoding="utf-8")
        print(f"READY. Instructions with the synthetic credentials: {WORK / 'koreader-session.md'}  (CA: {ca})", flush=True)
        timeline, last = [], None
        deadline = time.time() + MINUTES * 60
        done = WORK / "koreader-done"
        done.unlink(missing_ok=True)
        while time.time() < deadline and not done.exists():
            snap = {}
            for t, e in books.items():
                try:
                    kp_ = stack.api("GET", f"/editions/{e['id']}/koreader-position", rt)
                    web = stack.api("GET", f"/editions/{e['id']}/position", rt)
                    snap[t] = {"koreaderRevision": kp_["revision"], "source": kp_.get("source"), "progress": (kp_.get("position") or {}).get("value", {}) and kp_["position"]["value"].get("progress"),
                               "percentage": (kp_.get("position") or {}).get("value", {}) and kp_["position"]["value"].get("percentage"), "webRevision": web["revision"]}
                except SystemExit as ex:
                    snap[t] = {"error": str(ex)[:80]}
            try:
                snap["_conflicts"] = stack.api("GET", "/koreader/conflicts", rt)["total"] if "total" in stack.api("GET", "/koreader/conflicts", rt) else len(stack.api("GET", "/koreader/conflicts", rt)["items"])
            except SystemExit:
                snap["_conflicts"] = "?"
            if snap != last:
                timeline.append({"at": now(), "state": snap})
                last = snap
                print(now(), json.dumps(snap)[:300], flush=True)
            time.sleep(15)
        (OUT / "session-timeline.json").write_text(json.dumps({"base": f"https://{IP}:{PORT}", "timeline": timeline}, indent=2), encoding="utf-8")
        print("session ended; timeline saved")
        return 0
    finally:
        kill(proxy.pid)
        kill(srv.pid)
        stack.down(quiet=True)


sys.exit(main())
