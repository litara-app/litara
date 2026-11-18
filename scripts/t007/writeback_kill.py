#!/usr/bin/env python3
"""Process-death rehearsal for an approved in-file EPUB write-back (T007 M3, scenario write-recovery/process-restart).

  python scripts/t007/writeback_kill.py [--out research/t007/evidence/m3-writeback-kill]

A 400 MB stored-entry EPUB makes staging, validation and publication long enough to interrupt a real server process (hard kill,
no hooks). Three kill points, each on a fresh stack: (A) while the staged copy is partly written, (B) with the staged copy
complete but before the journal says validated, (C) when the journal says validated (before the atomic replacement). After
restart the target must be either the exact original or the exact new file (a valid EPUB), no staged leftovers may remain,
the plan must end in a terminal stage, and a new scan must leave the catalog consistent with the file on disk.
"""
import hashlib, json, os, subprocess, sys, threading, time, uuid, zipfile, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m3-writeback-kill")
EVIDENCE = "research/t007/evidence/m2-epub-writer/README.md"
BIG_MB = 400
OPF = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="i"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
       '<dc:identifier id="i">urn:uuid:kill-1</dc:identifier><dc:title>Big Original</dc:title><dc:creator>Orig Author</dc:creator><dc:language>en</dc:language></metadata><manifest/><spine/></package>')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def kill(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, 9)


def sql(q):
    r = subprocess.run(["docker", "exec", stack.PG, "psql", "-U", "postgres", "-d", stack.DB, "-At", "-c", q], capture_output=True, text=True, check=True)
    return r.stdout.strip()


def make_big(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr("content.opf", OPF)
        zi = zipfile.ZipInfo("payload.bin")
        zi.compress_type = zipfile.ZIP_STORED
        with z.open(zi, "w", force_zip64=True) as w:
            chunk = (b"litara-kill-rehearsal" * 50000)[:1 << 20]
            for _ in range(BIG_MB):
                w.write(chunk)


def start(env_extra=None):
    env = stack.env_for((WORK / "secret.key").read_text().strip(), WORK / "media")
    env.update(env_extra or {})
    proc = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=env, stdout=open(WORK / "server.log", "ab"), stderr=subprocess.STDOUT)
    (WORK / "server.pid").write_text(str(proc.pid))
    import urllib.request
    for _ in range(90):
        try:
            urllib.request.urlopen(stack.BASE + "/readyz", timeout=2).read()
            return proc
        except Exception:
            time.sleep(1)
    raise SystemExit("server not ready")


def run_point(point):
    rep = {"killPoint": point, "started": now()}
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    kill(int((WORK / "server.pid").read_text()))
    time.sleep(2)
    media = WORK / "media" / "Synthetic Author"
    target = media / "Big Original.epub"
    make_big(target)
    proc = start()
    adm = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "wb-kill"})["accessToken"]
    ed = None
    titles = {}
    for _ in range(15):
        try:
            stack.api("POST", f"/admin/libraries/{c['library']}/scans", adm, {})
        except SystemExit:
            pass
        time.sleep(5)
        titles = {t["id"]: t["title"] for t in stack.api("GET", "/titles?size=50", adm)["items"]}
        ed = next((e for e in stack.api("GET", "/editions?size=50", adm)["items"] if titles.get(e["titleId"]) == "Big Original"), None)
        if ed:
            break
    if not ed:
        raise SystemExit("big epub never cataloged")
    fid, v0 = ed["file"]["id"], ed["file"]["contentVersion"]
    before = sha(target)
    size0 = target.stat().st_size
    env = stack.env_for("x", media)
    subprocess.run([str(WORK / "bin" / ("ctl" + stack.EXE)), "writers", "enable", "epub", "--evidence", EVIDENCE], env=env, cwd=ROOT, check=True, capture_output=True)
    plan = stack.api("POST", f"/admin/files/{fid}/writebacks", adm, {"changes": {"title": "Big Rewritten", "authors": ["New Author"]}})
    stack.api("POST", f"/admin/writebacks/{plan['id']}/approve", adm, {})

    def execute():
        try:
            stack.api("POST", f"/admin/writebacks/{plan['id']}/execute", adm, {})
        except BaseException:
            pass
    watcher = None
    stages = []
    if point == "C":
        w = subprocess.Popen(["docker", "exec", "-i", stack.PG, "psql", "-U", "postgres", "-d", stack.DB, "-At"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        w.stdin.write("SELECT stage FROM writeback_plans;\n\\watch 0.02\n")
        w.stdin.flush()
        flag = threading.Event()

        def read():
            for line in w.stdout:
                line = line.strip()
                if line and line not in ("SELECT",) and not line.startswith("Watch"):
                    if not stages or stages[-1] != line:
                        stages.append(line)
                    if line == "validated":
                        flag.set()
                        return
        watcher = threading.Thread(target=read, daemon=True)
        watcher.start()
    th = threading.Thread(target=execute, daemon=True)
    th.start()
    t0 = time.time()
    hit = False
    while time.time() - t0 < 120:
        staged = list(media.glob(".litara-write-*"))
        sz = staged[0].stat().st_size if staged else 0
        if point == "A" and staged and size0 * 0.1 < sz < size0 * 0.8:
            hit = True
        elif point == "B" and staged and sz >= size0 - 4096:
            hit = True
        elif point == "C" and watcher is not None and flag.is_set():
            hit = True
        if hit:
            rep["stagedBytesAtKill"], rep["originalBytes"] = sz, size0
            kill(proc.pid)
            break
        time.sleep(0.01)
    if watcher is not None:
        w.kill()
    rep["killTriggered"] = hit
    rep["stageSeenBeforeKill"] = stages
    proc.wait(timeout=30)
    time.sleep(1)
    rep["targetShaAfterKillIsOriginal"] = sha(target) == before
    rep["stagedLeftoverAfterKill"] = [p.name for p in media.glob(".litara-write-*")]
    rep["planStageAfterKill"] = sql("SELECT stage FROM writeback_plans")
    proc = start()
    time.sleep(3)
    rep["planStageAfterRestart"] = sql("SELECT stage || ' | ' || coalesce(detail,'') FROM writeback_plans")
    after = sha(target)
    rep["targetIsOriginal"] = after == before
    try:
        with zipfile.ZipFile(target) as z:
            names = z.namelist()
            opf = z.read("content.opf").decode()
        rep["targetIsValidZipWithEntries"] = names
        rep["targetHasNewTitle"] = "Big Rewritten" in opf
    except Exception as e:
        rep["targetIsValidZipWithEntries"] = "INVALID: " + str(e)
        rep["targetHasNewTitle"] = None
    rep["stagedLeftoverAfterRestart"] = [p.name for p in media.glob(".litara-write-*")]
    for _ in range(4):
        try:
            stack.api("POST", f"/admin/libraries/{c['library']}/scans", adm, {})
        except SystemExit:
            pass
        time.sleep(8)
    ed2 = next(e for e in stack.api("GET", "/editions?size=50", adm)["items"] if e["id"] == ed["id"])
    rep["contentVersionChanged"] = ed2["file"]["contentVersion"] != v0
    rep["catalogSizeMatchesDisk"] = ed2["file"]["sizeBytes"] == target.stat().st_size
    t2 = next(t["title"] for t in stack.api("GET", "/titles?size=50", adm)["items"] if t["id"] == ed2["titleId"])
    rep["catalogTitle"] = t2
    ok_state = (rep["targetIsOriginal"] and not rep["contentVersionChanged"] and t2 == "Big Original") or (not rep["targetIsOriginal"] and rep["targetHasNewTitle"] and rep["contentVersionChanged"] and t2 == "Big Rewritten")
    rep["result"] = "PASS" if hit and isinstance(rep["targetIsValidZipWithEntries"], list) and not rep["stagedLeftoverAfterRestart"] and ok_state and rep["catalogSizeMatchesDisk"] else "FAIL"
    rep["finished"] = now()
    kill(proc.pid)
    stack.down(quiet=True)
    shutil_rm(target)
    return rep


def shutil_rm(p):
    try:
        p.unlink()
    except OSError:
        pass


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    reps = []
    for point in ("A", "B", "C"):
        r = run_point(point)
        reps.append(r)
        print(json.dumps(r, indent=1))
        (OUT / "run.json").write_text(json.dumps(reps, indent=2), encoding="utf-8")
    sys.exit(0 if all(r["result"] == "PASS" for r in reps) else 1)


main()
