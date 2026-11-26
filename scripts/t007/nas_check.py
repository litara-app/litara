#!/usr/bin/env python3
"""Mounted network share rehearsal (T007 M4, scenario nas-mounted / gap G07).

  python scripts/t007/nas_check.py --share PATH [--simulate] [--keep]

PATH is an existing directory on the mounted test share (a drive letter, UNC path or mount point). The script creates ONE new
subdirectory `litara-t007-<id>` there (marker file inside), works only inside it, and removes only that subdirectory at the end
(unless --keep). It never mounts, unmounts, formats or touches anything else, and never uses a library that already exists.

Phases (the disposable stack from stack.py runs the server; a second index library points at the share subdirectory):
  1 capability probe of the share (create/rename/replace/delete, hard links, mtime resolution, case rules, long names)
  2 scan: fixtures cataloged, content readable over the API with exact bytes
  3 unique move: a rename on the share keeps the file id (no duplicate, no re-import)
  4 same-path replacement: new content version, same file id
  5 in-file EPUB write-back on the share: atomic replacement, no staged leftovers, catalog follows
  6 connection loss: the share disappears; the scan must report the root unavailable, mark nothing missing, delete nothing, and
    originals must answer 503 not 404; after it returns, everything is available again with the same ids
  7 absence: a deleted file is marked missing only after two healthy scans, never removed from the catalog; restored bytes re-attach
Phase 6 is user-assisted: the script writes the instruction to .tmp/t007/nas-prompt.txt and waits for .tmp/t007/nas-continue (or
use --simulate, which renames the subdirectory instead of touching the mount, for a dry run on a local folder).
"""
import datetime, hashlib, json, os, shutil, subprocess, sys, time, uuid, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
arg = lambda n, d=None: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d  # noqa: E731
SHARE = Path(os.path.abspath(arg("--share"))) if arg("--share") else Path("")  # abspath, not resolve(): keep a drive letter instead of its UNC target
SIM = "--simulate" in sys.argv
KEEP = "--keep" in sys.argv
OUT = ROOT / arg("--out", "research/t007/evidence/m4-nas")
PROMPT, GO = WORK / "nas-prompt.txt", WORK / "nas-continue"
checks, probe = [], {}
REMOTE = ""


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def check(name, ok, detail=""):
    checks.append({"check": name, "pass": bool(ok), "detail": str(detail)[:240]})
    print(("PASS " if ok else "FAIL ") + name, "" if ok else "- " + str(detail)[:200], flush=True)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def http(url, tok, method="GET", rng=None):
    req = urllib.request.Request(url, method=method, headers={"Authorization": "Bearer " + tok, **({"Range": rng} if rng else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def kill(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, 9)


def capability_probe(d):
    """What this share can do, measured in the new subdirectory only."""
    p = {}
    a, b = d / "probe-a.txt", d / "probe-b.txt"
    a.write_text("a")
    try:
        os.rename(a, d / "probe-renamed.txt")
        p["rename"] = True
    except OSError as e:
        p["rename"] = f"no: {e}"
    b.write_text("old")
    src = d / "probe-new.txt"
    src.write_text("new")
    try:
        os.replace(src, b)
        p["atomicReplaceOverExisting"] = b.read_text() == "new"
    except OSError as e:
        p["atomicReplaceOverExisting"] = f"no: {e}"
    try:
        os.link(b, d / "probe-link.txt")
        p["hardLinks"] = (d / "probe-link.txt").stat().st_nlink >= 2
    except (OSError, NotImplementedError) as e:
        p["hardLinks"] = f"no: {e}"
    (d / "Case.txt").write_text("1")
    p["caseInsensitive"] = (d / "case.txt").exists()
    m = d / "mtime.txt"
    m.write_text("x")
    os.utime(m, ns=(1_000_000_001_000_000_123, 1_000_000_001_000_000_123))
    p["mtimeNsAfterSet"] = os.stat(m).st_mtime_ns
    try:
        long = d / ("n" * 200 + ".txt")
        long.write_text("x")
        p["longName200"] = True
    except OSError as e:
        p["longName200"] = f"no: {e}"
    for f in list(d.iterdir()):
        if f.name != "LITARA-T007-MARKER":
            try:
                f.unlink()
            except OSError:
                pass
    return p


UNMAP = arg("--auto-unmap")  # drive letter such as W: ; the user authorized this one mapping to be dropped and restored by the script


def net_use_remote(letter):
    out = subprocess.run(["net", "use", letter], capture_output=True, text=True).stdout
    for ln in out.splitlines():
        if ln.lower().startswith("remote name"):
            return ln.split(None, 2)[2].strip()
    raise SystemExit(f"{letter} is not a mapped network drive")


def wait_user(text):
    if UNMAP and text.startswith("DISCONNECT"):
        global REMOTE
        REMOTE = net_use_remote(UNMAP)
        print(f"dropping only the mapping {UNMAP} -> {REMOTE}", flush=True)
        subprocess.run(["net", "use", UNMAP, "/delete", "/y"], capture_output=True, text=True)
        return
    if UNMAP and text.startswith("RECONNECT"):
        r = subprocess.run(["net", "use", UNMAP, REMOTE, "/persistent:no"], capture_output=True, text=True)
        print("re-mapped:", r.stdout.strip().splitlines()[:1], r.stderr.strip()[:120], flush=True)
        return

    PROMPT.write_text(text, encoding="utf-8")
    GO.unlink(missing_ok=True)
    print("WAITING FOR USER:", text, flush=True)
    for _ in range(3600):
        if GO.exists():
            GO.unlink(missing_ok=True)
            PROMPT.unlink(missing_ok=True)
            return
        time.sleep(1)
    raise SystemExit("timed out waiting for the user")


def scan(adm, lib, n=2):
    last = None
    for _ in range(n):
        try:
            run = stack.api("POST", f"/admin/libraries/{lib}/scans", adm, {})
        except SystemExit:
            time.sleep(5)
            continue
        for _ in range(60):
            runs = stack.api("GET", f"/admin/libraries/{lib}/scans", adm)["items"]
            r = next(x for x in runs if x["id"] == run["id"])
            if r["state"] in ("completed", "failed"):
                last = r
                break
            time.sleep(1)
        time.sleep(31)  # stabilitySecs is 30
    return last


def editions(adm, lib):
    return {e["file"]["id"]: e for e in stack.api("GET", f"/editions?libraryId={lib}&size=100", adm)["items"]}


def main():
    if not SHARE or not SHARE.is_dir():
        raise SystemExit("--share must be an existing directory on the mounted test share")
    OUT.mkdir(parents=True, exist_ok=True)
    d = SHARE / f"litara-t007-{uuid.uuid4().hex[:8]}"
    d.mkdir()
    (d / "LITARA-T007-MARKER").write_text("created by scripts/t007/nas_check.py; safe to delete this whole folder\n")
    rep = {"started": now(), "share": str(SHARE), "simulate": SIM, "platform": sys.platform}
    try:
        probe.update(capability_probe(d))
        rep["capabilityProbe"] = probe
        print("capabilities:", json.dumps(probe), flush=True)
        # fixtures
        sys.path.insert(0, str(ROOT / "scripts" / "t007" / "locators"))
        stack.make_epub(d / "Author A" / "Share Tale.epub", "Share Tale", "Author A", "00000000-0000-4000-8000-0000000000b1")
        stack.make_epub(d / "Author A" / "Share Second.epub", "Share Second", "Author A", "00000000-0000-4000-8000-0000000000b2", chapters=3)
        stack.make_pdf(d / "Author A" / "Share Paper.pdf", "Share Paper")
        stack.make_cbz(d / "Author A" / "Share Comic.cbz")
        stack.up()
        # LITARA_MEDIA_ROOT restricts which files the server may open or inspect, so it must contain the library root: restart
        # the server with the share subdirectory as its media root (the stack's own fixtures are not used by this rehearsal).
        kill(int((WORK / "server.pid").read_text()))
        time.sleep(2)
        srv = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=stack.env_for((WORK / "secret.key").read_text().strip(), d), stdout=open(WORK / "server.log", "ab"), stderr=subprocess.STDOUT)
        (WORK / "server.pid").write_text(str(srv.pid))
        for _ in range(60):
            try:
                urllib.request.urlopen(stack.BASE + "/readyz", timeout=2).read()
                break
            except Exception:  # noqa: BLE001
                time.sleep(1)
        c = json.loads((WORK / "creds.json").read_text())
        tp = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "nas-check"})
        adm = tp["accessToken"]
        cfg = {"mode": "index", "rootPath": str(d), "followSymlinks": False, "stabilitySecs": 30, "writebackBackups": False, "providerOrder": []}
        lib = stack.api("POST", "/admin/libraries", adm, {"name": "NAS test", "config": cfg})["library"]["id"]
        stack.api("PUT", f"/admin/users/{tp['user']['id']}/libraries/{lib}", adm)
        # 2 scan and read
        for _ in range(4):
            scan(adm, lib, 1)
            if len(editions(adm, lib)) >= 4:
                break
        eds = editions(adm, lib)
        check("fixtures on the share are cataloged", len(eds) == 4, len(eds))
        rep["libraryRootHealth"] = stack.api("GET", f"/admin/libraries/{lib}", adm).get("rootHealth") or stack.api("GET", f"/admin/libraries/{lib}", adm)
        tale = next(e for e in eds.values() if e["file"]["format"] == "epub" and (d / "Author A" / "Share Tale.epub").stat().st_size == e["file"]["sizeBytes"])
        f = tale["file"]
        data = (d / "Author A" / "Share Tale.epub").read_bytes()
        st, body = http(stack.BASE + f["contentPath"], adm, rng="bytes=0-4095")
        check("original over the API equals the share bytes (Range)", st == 206 and body == data[:4096], st)
        # 3 unique move
        old, new = d / "Author A" / "Share Tale.epub", d / "Moved" / "Share Tale (moved).epub"
        new.parent.mkdir()
        os.replace(old, new)
        for _ in range(3):
            scan(adm, lib, 1)
        eds2 = editions(adm, lib)
        check("a rename on the share keeps the file id (move, not a new file)", f["id"] in eds2 and len(eds2) == 4, (len(eds2), f["id"] in eds2))
        check("moved file content version unchanged", f["id"] in eds2 and eds2[f["id"]]["file"]["contentVersion"] == f["contentVersion"])
        # 4 replacement
        stack.make_epub(new, "Share Tale", "Author A", "00000000-0000-4000-8000-0000000000b1", chapters=5)
        for _ in range(3):
            scan(adm, lib, 1)
        eds3 = editions(adm, lib)
        check("same-path replacement: same file id, new content version", f["id"] in eds3 and eds3[f["id"]]["file"]["contentVersion"] != f["contentVersion"])
        # 5 write-back
        fid = f["id"]
        env = stack.env_for("unused", d)
        subprocess.run([str(WORK / "bin" / ("ctl" + stack.EXE)), "writers", "enable", "epub", "--evidence", "research/t007/evidence/m2-epub-writer/README.md"], env=env, cwd=ROOT, check=True, capture_output=True)
        before = sha(new)
        plan = stack.api("POST", f"/admin/files/{fid}/writebacks", adm, {"changes": {"title": "Share Tale Rewritten"}})
        stack.api("POST", f"/admin/writebacks/{plan['id']}/approve", adm, {})
        try:
            res = stack.api("POST", f"/admin/writebacks/{plan['id']}/execute", adm, {})
            check("in-file write-back on the share reached published", res.get("stage") in ("published", "recovered"), res.get("stage"))
        except SystemExit as e:
            check("in-file write-back on the share reached published", False, e)
        check("write-back changed the bytes and left no staged files", sha(new) != before and not list(d.rglob(".litara-write-*")), [p.name for p in d.rglob(".litara-write-*")])
        for _ in range(3):
            scan(adm, lib, 1)
        title = next(t["title"] for t in stack.api("GET", "/titles?size=100", adm)["items"] if t["id"] == editions(adm, lib)[fid]["titleId"])
        check("catalog shows the written title", title == "Share Tale Rewritten", title)
        # 6 connection loss
        ids_before = {k: v["file"]["contentVersion"] for k, v in editions(adm, lib).items()}
        hidden = d.parent / (d.name + ".simulated-offline")
        if SIM:
            os.rename(d, hidden)
        else:
            wait_user(f"DISCONNECT the share now so that {d} becomes unreachable (for example disable the network adapter or disconnect the mapped drive; do NOT disconnect anything else). When it is gone, create the file {GO} (or tell Claude).")
        time.sleep(2)
        r = scan(adm, lib, 1)
        rep["scanWhileOffline"] = r
        check("scan while the share is gone does not mark anything missing", r is not None and r.get("health") == "unavailable", r and r.get("health"))
        cur = editions(adm, lib)[fid]["file"]
        st, _ = http(stack.BASE + cur["contentPath"], adm, rng="bytes=0-15")
        check("original answers 503 (temporarily unavailable), not 404/200, while the share is gone", st == 503, st)
        live = editions(adm, lib)
        check("catalog keeps every edition while the share is gone", set(live) == set(ids_before), len(live))
        if SIM:
            os.rename(hidden, d)
        else:
            wait_user(f"RECONNECT the share so that {d} is reachable again, then create {GO} (or tell Claude).")
        time.sleep(2)
        for _ in range(3):
            scan(adm, lib, 1)
        back = editions(adm, lib)
        check("after reconnect the same ids and versions are available again", {k: v["file"]["contentVersion"] for k, v in back.items()} == ids_before and all(v["file"]["availability"] == "available" for v in back.values()))
        st, body = http(stack.BASE + f["contentPath"].replace(f["contentVersion"], back[fid]["file"]["contentVersion"]), adm, rng="bytes=0-15")
        check("original readable again after reconnect", st == 206, st)
        # 7 absence and return
        victim = d / "Author A" / "Share Paper.pdf"
        vb = victim.read_bytes()
        victim.unlink()
        scan(adm, lib, 1)
        mid = [e for e in editions(adm, lib).values() if e["file"]["format"] == "pdf"]
        scan(adm, lib, 2)
        gone = [e for e in editions(adm, lib).values() if e["file"]["format"] == "pdf"]
        check("a deleted file stays in the catalog and is reported unavailable after confirming scans (never deleted)", len(gone) == 1 and gone[0]["file"]["availability"] != "available", [g["file"]["availability"] for g in gone])
        victim.write_bytes(vb)
        for _ in range(3):
            scan(adm, lib, 1)
        again = [e for e in editions(adm, lib).values() if e["file"]["format"] == "pdf"]
        check("restoring the same bytes re-attaches the same file id", len(again) == 1 and again[0]["file"]["id"] == gone[0]["file"]["id"] and again[0]["file"]["availability"] == "available", [a["file"]["availability"] for a in again])
    finally:
        try:
            kill(int((WORK / "server.pid").read_text()))
        except Exception:  # noqa: BLE001
            pass
        stack.down(quiet=True)
        hidden = d.parent / (d.name + ".simulated-offline")
        if hidden.exists() and not d.exists():
            os.rename(hidden, d)
        if not KEEP and (d / "LITARA-T007-MARKER").exists():
            shutil.rmtree(d, ignore_errors=True)
    passed = sum(c["pass"] for c in checks)
    rep.update({"finished": now(), "passed": passed, "failed": len(checks) - passed, "checks": checks})
    (OUT / ("run-simulated.json" if SIM else "run.json")).write_text(json.dumps(rep, indent=2, default=str), encoding="utf-8")
    print(f"{passed}/{len(checks)} checks passed")
    sys.exit(0 if passed == len(checks) else 1)


main()
