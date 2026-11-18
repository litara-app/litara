#!/usr/bin/env python3
"""Process-death recovery rehearsal for comic page extraction (T007 M3, scenario process-restart).

  python scripts/t007/kill_recovery.py [--out research/t007/evidence/m3-kill-recovery] [--rescue 90s]

Builds the disposable stack, adds a large comic (many big pages so extraction takes long enough to interrupt), asks for its
pages, waits until partial extraction is observable on disk, kills the real server process hard (no shutdown hooks), and records
what a client and the database show while the server is dead/restarted. It then restarts the server and measures when the
queued work resumes, comparing the final manifest with the file's own page count.
"""
import json, os, subprocess, sys, time, uuid, urllib.request, urllib.error, zipfile, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m3-kill-recovery")
RESCUE = sys.argv[sys.argv.index("--rescue") + 1] if "--rescue" in sys.argv else "90s"
PAGES, W, H = 300, 3000, 2000


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def sql(q):
    r = subprocess.run(["docker", "exec", stack.PG, "psql", "-U", "postgres", "-d", stack.DB, "-At", "-c", q], capture_output=True, text=True, check=True)
    return r.stdout.strip()


def kill(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, 9)


def start(key_env_extra):
    key = (WORK / "secret.key").read_text().strip()
    env = stack.env_for(key, WORK / "media")
    env.update(key_env_extra)
    log = open(WORK / "server.log", "ab")
    proc = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=env, stdout=log, stderr=subprocess.STDOUT)
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
    rep = {"started": now(), "rescueStuckAfter": RESCUE}
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    pid = int((WORK / "server.pid").read_text())
    kill(pid)
    time.sleep(2)
    # a big comic: one large solid-colour PNG repeated under distinct names
    row = bytes([90, 140, 200]) * W
    png = stack._png(W, H, [row] * H)
    cbz = WORK / "media" / "Synthetic Author" / "Big Comic.cbz"
    with zipfile.ZipFile(cbz, "w") as z:
        for n in range(1, PAGES + 1):
            z.writestr(f"{n:04d}.png", png, compress_type=zipfile.ZIP_STORED)
    rep["fixture"] = {"pages": PAGES, "pixels": f"{W}x{H}", "bytes": cbz.stat().st_size}
    extra = {"LITARA_RESCUE_STUCK_AFTER": RESCUE}
    proc = start(extra)
    tok = stack.api("POST", "/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "kill-rehearsal"})["accessToken"]
    adm = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "kill-rehearsal-a"})["accessToken"]
    ed = None
    for _ in range(10):
        try:
            stack.api("POST", f"/admin/libraries/{c['library']}/scans", adm, {})
        except SystemExit:
            pass
        time.sleep(4)
        titles = {t["id"]: t["title"] for t in stack.api("GET", "/titles?size=50", tok)["items"]}
        ed = next((e for e in stack.api("GET", "/editions?size=50", tok)["items"] if titles.get(e["titleId"]) == "Big Comic"), None)
        if ed:
            break
    if not ed:
        raise SystemExit("Big Comic never cataloged")
    f = ed["file"]
    pp = f"/files/{f['id']}/versions/{f['contentVersion']}/pages"
    t0 = time.time()
    stack.api("POST", pp, tok, {"operationId": str(uuid.uuid4()), "baseRevision": ed["revision"], "contentVersion": f["contentVersion"]})
    cache = WORK / "cache" / "comics"
    seen = 0
    for _ in range(400):
        files = [p for p in cache.rglob("*") if p.is_file()] if cache.exists() else []
        seen = len(files)
        if seen >= 5:
            break
        time.sleep(0.05)
    rep["partialFilesOnDiskAtKill"] = seen
    st_before = sql("SELECT status, jsonb_array_length(pages) FROM comic_extractions")
    kill(proc.pid)
    t_kill = time.time()
    rep["killedAfterSeconds"] = round(t_kill - t0, 2)
    rep["rowAtKill"] = st_before
    proc.wait(timeout=30)
    time.sleep(1)
    rep["rowAfterDeath"] = sql("SELECT status, jsonb_array_length(pages), cache_bytes FROM comic_extractions")
    rep["partialFilesAfterDeath"] = len([p for p in cache.rglob("*") if p.is_file()]) if cache.exists() else 0
    rep["riverJobAfterDeath"] = sql("SELECT state, attempt FROM river_job WHERE kind='comic_extract'")
    # restart and observe
    proc = start(extra)
    t_up = time.time()
    seq = []
    final = None
    for _ in range(int((10 * 60) / 2)):
        try:
            tok = stack.api("POST", "/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "kill-rehearsal"})["accessToken"] if not seq else tok
            m = stack.api("GET", pp, tok)
            state = (m.get("state") or m.get("status"), len(m.get("pages") or []))
        except SystemExit as e:
            state = ("error", str(e)[:120])
        if not seq or seq[-1][1] != state:
            seq.append((round(time.time() - t_up, 1), state))
        if state[0] == "ready":
            final = m
            break
        time.sleep(2)
    rep["manifestStatesAfterRestart"] = seq
    rep["secondsFromRestartToReady"] = round(time.time() - t_up, 1)
    if final:
        rep["finalPages"] = len(final["pages"])
        rep["finalMatchesFile"] = len(final["pages"]) == PAGES
        files = [p for p in cache.rglob("*") if p.is_file()]
        rep["cacheFilesAtReady"] = len(files)
        idx = stack.api("GET", f"{pp}/{PAGES - 1}", tok) if False else None
    rep["riverJobsAfter"] = sql("SELECT state, attempt FROM river_job WHERE kind='comic_extract'")
    rep["duplicateRows"] = sql("SELECT count(*) FROM comic_extractions")
    rep["finished"] = now()
    ok = bool(final) and rep["finalMatchesFile"] and rep["duplicateRows"] == "1"
    rep["result"] = "PASS" if ok else "FAIL"
    (OUT / "run.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    kill(proc.pid)
    stack.down(quiet=True)
    print(json.dumps(rep, indent=1))
    sys.exit(0 if ok else 1)


main()
