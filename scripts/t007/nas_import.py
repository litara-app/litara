#!/usr/bin/env python3
"""Copy-only import onto a mounted share that has no hard links (T007 M4, gap G07; companion of nas_check.py).

  python scripts/t007/nas_import.py --share W:\

Creates litara-t007-imp-<id> on the share (marker file; only that folder is removed afterwards) as the root of a MANAGED library, plans an
import from a local read-only source folder, then (a) replaces nothing: it pre-creates a conflicting file at one target after the plan
and expects that item to fail without overwriting it, and (b) expects the other items to publish with the exact reviewed bytes through
the checked-rename fallback (hard links are unavailable on SMB), leaving no temporary copies.
"""
import hashlib, json, os, shutil, subprocess, sys, time, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
SHARE = Path(os.path.abspath(sys.argv[sys.argv.index("--share") + 1]))
OUT = ROOT / "research/t007/evidence/m4-nas"
checks = []


def check(n, ok, d=""):
    checks.append({"check": n, "pass": bool(ok), "detail": str(d)[:240]})
    print(("PASS " if ok else "FAIL ") + n, "" if ok else "- " + str(d)[:200], flush=True)


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def kill(pid):
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    d = SHARE / f"litara-t007-imp-{uuid.uuid4().hex[:8]}"
    d.mkdir()
    (d / "LITARA-T007-MARKER").write_text("created by scripts/t007/nas_import.py\n")
    src = WORK / "nas-import-src"
    shutil.rmtree(src, ignore_errors=True)
    src.mkdir(parents=True)
    for i in (1, 2, 3):
        stack.make_epub(src / f"Import {i}.epub", f"Import {i}", "Imp Author", f"00000000-0000-4000-8000-0000000000c{i}", chapters=i + 1)
    hashes = {p.name: sha(p) for p in src.iterdir()}
    rep = {}
    try:
        stack.up()
        kill(int((WORK / "server.pid").read_text()))
        time.sleep(2)
        import urllib.request
        srv = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=stack.env_for((WORK / "secret.key").read_text().strip(), d), stdout=open(WORK / "server.log", "ab"), stderr=subprocess.STDOUT)
        (WORK / "server.pid").write_text(str(srv.pid))
        for _ in range(60):
            try:
                urllib.request.urlopen(stack.BASE + "/readyz", timeout=2).read()
                break
            except Exception:
                time.sleep(1)
        c = json.loads((WORK / "creds.json").read_text())
        tp = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "nas-import"})
        adm = tp["accessToken"]
        cfg = {"mode": "managed", "rootPath": str(d), "followSymlinks": False, "stabilitySecs": 30, "writebackBackups": False, "providerOrder": []}
        lib = stack.api("POST", "/admin/libraries", adm, {"name": "NAS managed", "config": cfg})["library"]["id"]
        stack.api("PUT", f"/admin/users/{tp['user']['id']}/libraries/{lib}", adm)
        plan = stack.api("POST", f"/admin/libraries/{lib}/imports", adm, {"sourcePath": str(src)})
        check("import plan lists the 3 source files", len(plan["items"]) == 3, len(plan["items"]))
        victim = next(i for i in plan["items"] if i["sourceRel"].endswith("Import 2.epub"))
        target = d / victim["targetRel"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"someone else's file that must not be overwritten")
        before = target.read_bytes()
        stack.api("POST", f"/admin/libraries/{lib}/imports/{plan['id']}/approve", adm, {})
        stack.api("POST", f"/admin/libraries/{lib}/imports/{plan['id']}/execute", adm, {})
        done = None
        for _ in range(120):
            p = stack.api("GET", f"/admin/libraries/{lib}/imports/{plan['id']}", adm)
            if p["state"] in ("completed", "failed"):
                done = p
                break
            time.sleep(2)
        states = {i["sourceRel"]: i["state"] for i in done["items"]}
        rep["itemStates"] = states
        check("the conflicting target was not overwritten", target.read_bytes() == before)
        check("the conflicted item failed with a reason and the plan ended failed", states.get(victim["sourceRel"]) == "failed" and done["state"] == "failed", states)
        ok_items = [i for i in done["items"] if i["sourceRel"] != victim["sourceRel"]]
        check("the other items published with the exact reviewed bytes", all(i["state"] == "published" and sha(d / i["targetRel"]) == hashes[Path(i["sourceRel"]).name] for i in ok_items), [i["state"] for i in ok_items])
        check("no temporary copies remain on the share", not list(d.rglob(".litara-import-*")), [p.name for p in d.rglob(".litara-import-*")])
        check("the source folder is unchanged", {p.name: sha(p) for p in src.iterdir()} == hashes)
    finally:
        try:
            kill(int((WORK / "server.pid").read_text()))
        except Exception:
            pass
        stack.down(quiet=True)
        if (d / "LITARA-T007-MARKER").exists():
            shutil.rmtree(d, ignore_errors=True)
        shutil.rmtree(src, ignore_errors=True)
    passed = sum(x["pass"] for x in checks)
    rep.update({"share": str(SHARE), "passed": passed, "failed": len(checks) - passed, "checks": checks})
    (OUT / "run-import.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    print(f"{passed}/{len(checks)} checks passed")
    sys.exit(0 if passed == len(checks) else 1)


main()
