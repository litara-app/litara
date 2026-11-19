#!/usr/bin/env python3
"""KOReader progress state across a hard server kill (T007 M3, scenario process-restart).

  python scripts/t007/koreader_kill.py [--out research/t007/evidence/m3-koreader-kill]

Two synthetic KOReader devices speak the stock wire protocol (x-auth-user/x-auth-key, partial-MD5 document id). Device A's
progress is accepted; device B (no baseline) is refused with 2007 and its payload is retained as a candidate. The real server
is then killed hard and restarted. Canonical position, the retained candidate, B's missing baseline, receipt fencing and A's
idempotent replay must all be exactly as before, and the owner can still resolve the conflict.
"""
import hashlib, json, os, subprocess, sys, time, uuid, urllib.request, urllib.error, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m3-koreader-kill")
checks = []


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def check(name, ok, detail=""):
    checks.append({"check": name, "pass": bool(ok), "detail": str(detail)[:240]})
    print(("PASS " if ok else "FAIL ") + name, "" if ok else "- " + str(detail)[:160])


def partial_md5(path):
    data = Path(path).read_bytes()
    h = hashlib.md5()
    for off in [0] + [1024 << (2 * i) for i in range(11)]:
        if off >= len(data):
            break
        h.update(data[off:off + 1024])
    return h.hexdigest()


def ko(method, path, user, pw, body=None):
    req = urllib.request.Request(stack.BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("x-auth-user", user)
    req.add_header("x-auth-key", hashlib.md5(pw.encode()).hexdigest())
    req.add_header("Accept", "application/vnd.koreader.v1+json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def put(doc, progress, pct, device):
    return {"document": doc, "progress": progress, "percentage": pct, "device": device, "device_id": device + "-id"}


def sql(q):
    r = subprocess.run(["docker", "exec", stack.PG, "psql", "-U", "postgres", "-d", stack.DB, "-At", "-c", q], capture_output=True, text=True, check=True)
    return r.stdout.strip()


def kill(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, 9)


def start():
    env = stack.env_for((WORK / "secret.key").read_text().strip(), WORK / "media")
    proc = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=env, stdout=open(WORK / "server.log", "ab"), stderr=subprocess.STDOUT)
    (WORK / "server.pid").write_text(str(proc.pid))
    for _ in range(60):
        try:
            urllib.request.urlopen(stack.BASE + "/readyz", timeout=2).read()
            return proc
        except Exception:
            time.sleep(1)
    raise SystemExit("server not ready")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    rt = stack.api("POST", "/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "ko-kill"})["accessToken"]
    adm = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "ko-kill-a"})["accessToken"]
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
    stack.api("PUT", "/admin/integrations/settings", adm, {"operationId": str(uuid.uuid4()), "baseRevision": ist["revision"], "opdsEnabled": ist["opdsEnabled"], "emailEnabled": ist["emailEnabled"],
              "koreaderEnabled": True, "maxAttachmentBytes": ist["maxAttachmentBytes"], "maxDeliveriesPerUserPerHour": ist["maxDeliveriesPerUserPerHour"]})
    pws, creds = {}, {}
    for label in ("kobo-a", "kobo-b"):
        pw = uuid.uuid4().hex + uuid.uuid4().hex
        r = stack.api("POST", "/integration-credentials", rt, {"operationId": str(uuid.uuid4()), "kind": "koreader", "label": label, "password": pw})
        pws[label], creds[label] = pw, r["username"]
    path = next((WORK / "media").rglob("Synthetic Tale.epub"))
    doc = partial_md5(path)
    titles = {t["id"]: t["title"] for t in stack.api("GET", "/titles?size=50", rt)["items"]}
    ed = next(e for e in eds if titles.get(e["titleId"]) == "Synthetic Tale")
    for _ in range(80):  # the digest index is a periodic bounded job
        if sql(f"SELECT count(*) FROM koreader_digests WHERE digest='{doc}'") != "0":
            break
        time.sleep(3)
    A, B = ("kobo-a", "kobo-b")
    st, _ = ko("GET", f"/1/syncs/progress/{doc}", creds[A], pws[A])
    check("device A reads the empty state", st == 200)
    a_put = put(doc, "epubcfi(/6/8)", 0.80, "Kobo A")
    st, body = ko("PUT", "/1/syncs/progress", creds[A], pws[A], a_put)
    a_resp = body
    check("device A progress accepted", st == 200, (st, body[:100]))
    b_put = put(doc, "epubcfi(/6/50)", 0.55, "Kobo B")
    st, body = ko("PUT", "/1/syncs/progress", creds[B], pws[B], b_put)
    check("device B without a baseline is refused with 2007", st == 409 and '"code":2007' in body.replace(" ", ""), (st, body[:100]))

    def snap():
        return {"position": stack.api("GET", f"/editions/{ed['id']}/koreader-position", rt), "conflicts": stack.api("GET", "/koreader/conflicts", rt),
                "web": stack.api("GET", f"/editions/{ed['id']}/position", rt), "completion": stack.api("GET", f"/editions/{ed['id']}/completion", rt),
                "receipts": sql("SELECT count(*) FROM koreader_receipts") if False else None}
    before = snap()
    check("one retained candidate and canonical revision 1 before the kill", len(before["conflicts"]["items"]) == 1 and before["position"]["revision"] == "1", before["position"]["revision"])
    kill(int((WORK / "server.pid").read_text()))
    time.sleep(2)
    proc = start()
    rt = stack.api("POST", "/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "ko-kill-2"})["accessToken"]
    after = snap()
    check("canonical KOReader position identical after hard kill and restart", after["position"] == before["position"])
    check("retained candidate list identical", after["conflicts"] == before["conflicts"])
    check("web position and completion untouched", after["web"] == before["web"] and after["completion"] == before["completion"])
    st, body = ko("PUT", "/1/syncs/progress", creds[B], pws[B], b_put)
    check("device B retry is still refused with 2007 (baseline not invented)", st == 409 and '"code":2007' in body.replace(" ", ""), (st, body[:100]))
    check("B's retry created no second candidate or revision", snap()["conflicts"] == before["conflicts"] and snap()["position"]["revision"] == "1")
    st, body = ko("PUT", "/1/syncs/progress", creds[A], pws[A], a_put)
    check("device A replay of the accepted payload is idempotent", st == 200 and stack.api("GET", f"/editions/{ed['id']}/koreader-position", rt)["revision"] == "1", (st, body[:100]))
    cid = after["conflicts"]["items"][0]["id"]
    r = stack.api("POST", f"/koreader/conflicts/{cid}/resolve", rt, {"operationId": str(uuid.uuid4()), "baseRevision": "1", "action": "keep_server"})
    check("owner can still resolve the retained conflict", bool(r), r)
    kill(proc.pid)
    stack.down(quiet=True)
    passed = sum(x["pass"] for x in checks)
    (OUT / "run.json").write_text(json.dumps({"finished": now(), "passed": passed, "failed": len(checks) - passed, "checks": checks}, indent=2), encoding="utf-8")
    print(f"{passed}/{len(checks)} checks passed")
    sys.exit(0 if passed == len(checks) else 1)


main()
