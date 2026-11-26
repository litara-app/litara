#!/usr/bin/env python3
"""Process-death rehearsal for a reviewed copy-only import (T007 M3, scenario write-recovery/process-restart).

  python scripts/t007/import_kill.py [--out research/t007/evidence/m3-import-kill]

A managed library, a read-only source folder with six 150 MB EPUB-shaped files, plan -> approve -> execute. The real server is
killed hard while one item is being copied and at least one is already published. After restart the plan must resume and finish:
every target holds exactly the reviewed bytes, no temporary copy or duplicate remains, the source is unchanged, and a scan
catalogs each book once.
"""
import hashlib, json, os, subprocess, sys, time, zipfile, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m3-import-kill")
N, MB = 6, 150


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


def make(path, n):
    opf = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="i"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
           f'<dc:identifier id="i">urn:uuid:import-kill-{n}</dc:identifier><dc:title>Import Book {n}</dc:title><dc:creator>Import Author</dc:creator></metadata><manifest/><spine/></package>')
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr("content.opf", opf)
        zi = zipfile.ZipInfo("payload.bin")
        zi.compress_type = zipfile.ZIP_STORED
        with z.open(zi, "w", force_zip64=True) as w:
            chunk = (f"import-kill-{n}-".encode() * 100000)[:1 << 20]
            for i in range(MB):
                w.write(chunk[:-8] + i.to_bytes(8, "little"))


def start():
    env = stack.env_for((WORK / "secret.key").read_text().strip(), WORK / "media")
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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rep = {"started": now(), "files": N, "megabytesEach": MB}
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    kill(int((WORK / "server.pid").read_text()))
    time.sleep(2)
    src, lib_root = WORK / "import-src", WORK / "managed-lib"
    for d in (src, lib_root):
        if d.exists():
            import shutil
            shutil.rmtree(d)
        d.mkdir(parents=True)
    for n in range(1, N + 1):
        make(src / f"Import Book {n}.epub", n)
    src_hashes = {p.name: sha(p) for p in src.iterdir()}
    proc = start()
    tp = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "import-kill"})
    adm = tp["accessToken"]
    cfg = {"mode": "managed", "rootPath": str(lib_root), "followSymlinks": False, "stabilitySecs": 30, "writebackBackups": False, "providerOrder": []}
    lib = stack.api("POST", "/admin/libraries", adm, {"name": "Managed", "config": cfg})["library"]["id"]
    stack.api("PUT", f"/admin/users/{tp['user']['id']}/libraries/{lib}", adm)
    plan = stack.api("POST", f"/admin/libraries/{lib}/imports", adm, {"sourcePath": str(src)})
    rep["plannedItems"] = len(plan["items"])
    stack.api("POST", f"/admin/libraries/{lib}/imports/{plan['id']}/approve", adm, {})
    stack.api("POST", f"/admin/libraries/{lib}/imports/{plan['id']}/execute", adm, {})
    hit = False
    t0 = time.time()
    while time.time() - t0 < 180:
        st = sql("SELECT state FROM import_items ORDER BY target_rel").splitlines()
        if "copying" in st and "published" in st:
            hit = True
            break
        time.sleep(0.02)
    rep["itemStatesAtKill"] = sql("SELECT state, count(*) FROM import_items GROUP BY state ORDER BY state").splitlines()
    rep["planStateAtKill"] = sql("SELECT state FROM import_plans")
    rep["tempFilesAtKill"] = [str(p.relative_to(lib_root)) for p in lib_root.rglob(".litara-import-*")]
    rep["killTriggered"] = hit
    kill(proc.pid)
    proc.wait(timeout=30)
    time.sleep(1)
    rep["planStateAfterDeath"] = sql("SELECT state FROM import_plans")
    proc = start()
    final = None
    t1 = time.time()
    while time.time() - t1 < 600:
        final = sql("SELECT state FROM import_plans")
        if final in ("completed", "failed"):
            break
        time.sleep(3)
    rep["secondsToFinishAfterRestart"] = round(time.time() - t1, 1)
    rep["planStateAfterRestart"] = final
    rep["itemStatesFinal"] = sql("SELECT state, count(*) FROM import_items GROUP BY state ORDER BY state").splitlines()
    published = {p.name: p for p in lib_root.rglob("*.epub")}
    rep["targetFiles"] = len(published)
    rep["allTargetsMatchReviewedBytes"] = len(published) == N and all(sha(published[n]) == src_hashes[n] for n in src_hashes if n in published) and set(published) == set(src_hashes)
    rep["tempFilesAfterRestart"] = [str(p.relative_to(lib_root)) for p in lib_root.rglob(".litara-import-*")]
    rep["sourceUnchanged"] = {p.name: sha(p) for p in src.iterdir()} == src_hashes
    for _ in range(5):
        try:
            stack.api("POST", f"/admin/libraries/{lib}/scans", adm, {})
        except SystemExit:
            pass
        time.sleep(8)  # the scans together must span the 30 s stability window
    rep["editionsInManagedLibrary"] = sql(f"SELECT count(*) FROM editions WHERE library_id='{lib}'")
    rep["duplicateTitles"] = sql(f"SELECT count(*) FROM (SELECT title FROM titles GROUP BY title HAVING count(*) > 1) x")
    ok = hit and final == "completed" and rep["allTargetsMatchReviewedBytes"] and not rep["tempFilesAfterRestart"] and rep["sourceUnchanged"] and rep["editionsInManagedLibrary"] == str(N) and rep["duplicateTitles"] == "0"
    rep["result"] = "PASS" if ok else "FAIL"
    rep["finished"] = now()
    (OUT / "run.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    kill(proc.pid)
    stack.down(quiet=True)
    import shutil
    shutil.rmtree(src, ignore_errors=True)
    shutil.rmtree(lib_root, ignore_errors=True)
    print(json.dumps(rep, indent=1))
    sys.exit(0 if ok else 1)


main()
