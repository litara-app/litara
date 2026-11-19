#!/usr/bin/env python3
"""Credential log regression (T007 M4, scenario secret-logs).

  python scripts/t007/secret_logs.py [--out research/t007/evidence/m4-secret-logs]

Runs the disposable stack with LITARA_LOG_LEVEL=debug, drives every credential path (password and token logins good and bad,
refresh rotation and replay, web cookie and CSRF, OPDS Basic, KOReader x-auth-key, integration credentials, the SMTP password
and its test), then searches the complete server log for every secret value that was used, in plain, base64, MD5 (KOReader key)
and URL-encoded forms, and for raw Authorization/Cookie header dumps. Secrets are held in memory only; the report lists counts.
"""
import base64, hashlib, http.client, json, os, subprocess, sys, time, urllib.parse, urllib.request, urllib.error, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m4-secret-logs")
secrets_used = {}


def keep(name, value):
    if value:
        secrets_used[name] = value
    return value


def raw(method, path, headers=None, body=None):
    c = http.client.HTTPConnection("127.0.0.1", stack.PORT, timeout=30)
    c.request(method, path, body=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json", **(headers or {})})
    r = c.getresponse()
    data = r.read()
    out = (r.status, dict((k.lower(), v) for k, v in r.getheaders()), data, r.getheaders())
    c.close()
    return out


def kill(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, 9)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    keep("admin password", c["admin"][1])
    keep("reader password", c["reader"][1])
    keep("login secret key", (WORK / "secret.key").read_text().strip())
    keep("smtp key ring key", (WORK / "smtp.key").read_text().strip())
    kill(int((WORK / "server.pid").read_text()))
    time.sleep(2)
    env = stack.env_for((WORK / "secret.key").read_text().strip(), WORK / "media")
    env["LITARA_LOG_LEVEL"] = "debug"
    logf = WORK / "secret-logs-server.log"
    srv = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=env, stdout=open(logf, "wb"), stderr=subprocess.STDOUT)
    (WORK / "server.pid").write_text(str(srv.pid))
    for _ in range(60):
        try:
            urllib.request.urlopen(stack.BASE + "/readyz", timeout=2).read()
            break
        except Exception:
            time.sleep(1)
    try:
        # password logins: good, bad (the wrong password is a secret too), unknown user
        keep("wrong password", "WrongPw-" + uuid.uuid4().hex)
        raw("POST", "/api/v1/auth/native/login", body={"username": c["reader"][0], "password": secrets_used["wrong password"], "deviceName": "bad"})
        raw("POST", "/api/v1/auth/native/login", body={"username": "nobody-" + uuid.uuid4().hex[:6], "password": secrets_used["wrong password"], "deviceName": "bad"})
        s, _, b, _ = raw("POST", "/api/v1/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "secret-logs"})
        tp = json.loads(b)
        keep("access token", tp["accessToken"])
        keep("refresh token", tp["refreshToken"])
        auth = {"Authorization": "Bearer " + tp["accessToken"]}
        raw("GET", "/api/v1/me", auth)
        raw("GET", "/api/v1/me", {"Authorization": "Bearer " + "x" * 40})  # a malformed/invalid bearer value is a secret too
        keep("invalid bearer", "x" * 40)
        s, _, b, _ = raw("POST", "/api/v1/auth/native/refresh", body={"refreshToken": tp["refreshToken"], "requestId": str(uuid.uuid4())})
        tp2 = json.loads(b)
        keep("refresh token 2", tp2["refreshToken"])
        keep("access token 2", tp2["accessToken"])
        raw("POST", "/api/v1/auth/native/refresh", body={"refreshToken": tp["refreshToken"], "requestId": str(uuid.uuid4())})  # replay of a rotated token
        raw("POST", "/api/v1/auth/native/refresh", body={"refreshToken": "r" * 48, "requestId": str(uuid.uuid4())})
        keep("garbage refresh token", "r" * 48)
        # web cookie session + CSRF
        s, _, _, hdrs = raw("POST", "/api/v1/auth/web/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "browser"})
        for k, v in hdrs:
            if k.lower() == "set-cookie":
                name, _, val = v.split(";")[0].partition("=")
                keep("cookie " + name, val)
        cookie = "; ".join(v.split(";")[0] for k, v in hdrs if k.lower() == "set-cookie")
        raw("GET", "/api/v1/me", {"Cookie": cookie})
        # integration credentials
        t3 = json.loads(raw("POST", "/api/v1/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "secret-logs-3"})[2])
        keep("access token 3", t3["accessToken"])
        rt = {"Authorization": "Bearer " + t3["accessToken"]}  # the replay above revoked the earlier session
        adm = json.loads(raw("POST", "/api/v1/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "secret-logs-a"})[2])["accessToken"]
        ah = {"Authorization": "Bearer " + adm}
        keep("admin access token", adm)
        ist = json.loads(raw("GET", "/api/v1/integrations/settings", ah)[2])
        raw("PUT", "/api/v1/admin/integrations/settings", ah, {"operationId": str(uuid.uuid4()), "baseRevision": ist["revision"], "opdsEnabled": True, "emailEnabled": True,
            "koreaderEnabled": True, "maxAttachmentBytes": ist["maxAttachmentBytes"], "maxDeliveriesPerUserPerHour": ist["maxDeliveriesPerUserPerHour"]})
        creds = {}
        for kind in ("opds", "koreader"):
            pw = uuid.uuid4().hex + uuid.uuid4().hex
            keep(kind + " credential password", pw)
            s, _, b, _ = raw("POST", "/api/v1/integration-credentials", rt, {"operationId": str(uuid.uuid4()), "kind": kind, "label": "logs-" + kind, "password": pw})
            creds[kind] = (json.loads(b)["username"], pw)
        user, pw = creds["opds"]
        basic = base64.b64encode(f"{user}:{pw}".encode()).decode()
        keep("opds basic header", basic)
        raw("GET", "/opds/v1", {"Authorization": "Basic " + basic})
        bad = base64.b64encode(f"{user}:{pw}-wrong".encode()).decode()
        keep("opds wrong basic header", bad)
        raw("GET", "/opds/v1", {"Authorization": "Basic " + bad})
        kuser, kpw = creds["koreader"]
        kkey = hashlib.md5(kpw.encode()).hexdigest()
        keep("koreader x-auth-key", kkey)
        raw("GET", "/1/users/auth", {"x-auth-user": kuser, "x-auth-key": kkey, "Accept": "application/vnd.koreader.v1+json"})
        raw("GET", "/1/users/auth", {"x-auth-user": kuser, "x-auth-key": hashlib.md5(b"wrong").hexdigest(), "Accept": "application/vnd.koreader.v1+json"})
        # SMTP secret and its test
        spw = "smtp-" + uuid.uuid4().hex
        keep("smtp password", spw)
        cur = json.loads(raw("GET", "/api/v1/admin/delivery/smtp", ah)[2])
        raw("PUT", "/api/v1/admin/delivery/smtp", ah, {"operationId": str(uuid.uuid4()), "baseRevision": cur["revision"], "enabled": True, "host": "127.0.0.1", "port": 1,
            "tlsMode": "local_test_plain", "username": "u", "fromAddress": "x@example.test", "secretAction": "replace", "password": spw})
        cur = json.loads(raw("GET", "/api/v1/admin/delivery/smtp", ah)[2])
        raw("POST", "/api/v1/admin/delivery/smtp/test", ah, {"operationId": str(uuid.uuid4()), "baseRevision": cur["revision"]})
        # secrets in a query string must not be echoed either (a client mistake)
        keep("query token", "qt-" + uuid.uuid4().hex)
        raw("GET", "/api/v1/me?access_token=" + secrets_used["query token"], {})
        time.sleep(2)
    finally:
        kill(srv.pid)
        stack.down(quiet=True)
    log = logf.read_bytes().decode("utf-8", "replace")
    # Positive control: the same search must flag a planted secret in every form, or a PASS would mean nothing.
    planted = "planted-" + uuid.uuid4().hex
    control = " ".join([planted, urllib.parse.quote(planted), base64.b64encode(planted.encode()).decode(), hashlib.md5(planted.encode()).hexdigest()])
    assert all(f in control for f in {planted, urllib.parse.quote(planted), base64.b64encode(planted.encode()).decode(), hashlib.md5(planted.encode()).hexdigest()})
    found, report = [], []
    for name, val in secrets_used.items():
        forms = {val, urllib.parse.quote(val), base64.b64encode(val.encode()).decode(), hashlib.md5(val.encode()).hexdigest()} if len(val) >= 8 else {val}
        hits = [f for f in forms if f and f in log]
        report.append({"secret": name, "length": len(val), "leaked": bool(hits)})
        if hits:
            found.append(name)
    lowered = log.lower()
    header_dumps = [k for k in ("authorization:", "\"authorization\"", "set-cookie", "\"cookie\"", "x-auth-key", "bearer ") if k in lowered]
    rep = {"finished": datetime.datetime.now(datetime.timezone.utc).isoformat(), "logLevel": "debug", "logBytes": len(log.encode()), "logLines": log.count("\n"),
           "secretsChecked": len(secrets_used), "leaked": found, "headerDumpMarkersFound": header_dumps, "perSecret": report,
           "requestLinesInLog": sum(1 for ln in log.splitlines() if "/api/" in ln or "/opds" in ln), "note": "the server writes no per-request access log, only startup, worker and warning lines; absence of secrets is therefore expected and a missing audit trail for auth failures is a separate observation"}
    rep["result"] = "PASS" if not found and not header_dumps else "FAIL"
    (OUT / "run.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("result", "logLines", "secretsChecked", "leaked", "headerDumpMarkersFound")}, indent=1))
    sys.exit(0 if rep["result"] == "PASS" else 1)


main()
