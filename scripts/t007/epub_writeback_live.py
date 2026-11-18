#!/usr/bin/env python3
"""Live EPUB write-back through the real server (disposable stack from stack.py), checked independently of the Go tests.

  python scripts/t007/epub_writeback_live.py [--out research/t007/evidence/m2-epub-writer]

Steps: fresh stack; add the rich stress EPUB to the library; show the writer disabled with its reason; enable it with the operator command
`ctl writers enable`; plan, approve and execute a title/authors/series write over the HTTP API; then compare every zip entry of the
file on disk before and after with Python's zipfile (CRC and raw compressed bytes) and read the metadata back from the API.
"""
import hashlib, json, os, shutil, struct, subprocess, sys, time, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT = stack.ROOT
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m2-epub-writer")
EVIDENCE = "research/t007/evidence/m2-epub-writer/README.md"


def raw_entries(path):
    """name -> (method, crc, sha256 of the RAW compressed bytes) read straight from the archive bytes, not via zipfile's decompressor."""
    out = {}
    data = Path(path).read_bytes()
    with zipfile.ZipFile(path) as z:
        for i in z.infolist():
            off = i.header_offset
            n, m = struct.unpack("<HH", data[off + 26:off + 30])
            start = off + 30 + n + m
            out[i.filename] = (i.compress_type, i.CRC, hashlib.sha256(data[start:start + i.compress_size]).hexdigest(), i.file_size)
    return out


def scan(tok, library):
    """Start a scan; a scheduled one may already be running (409 scan_active), which is fine: wait for it instead."""
    try:
        stack.api("POST", f"/admin/libraries/{library}/scans", tok, {})
    except SystemExit as e:
        if "scan_active" not in str(e):
            raise
    time.sleep(4)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stack.up()
    c = json.loads((stack.WORK / "creds.json").read_text())
    tok = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "writeback-live"})["accessToken"]
    media = stack.WORK / "media" / "Synthetic Author"
    sys.path.insert(0, str(ROOT / "scripts" / "t007" / "locators"))
    import make_fixtures
    make_fixtures.make_epub(media / "Rich Book.epub")
    time.sleep(3)
    for _ in range(3):
        scan(tok, c["library"])
    eds = stack.api("GET", "/editions?size=50", tok)["items"]
    titles = {t["id"]: t["title"] for t in stack.api("GET", "/titles?size=50", tok)["items"]}
    ed = next(e for e in eds if e["file"]["format"] == "epub" and titles.get(e["titleId"]) == "Locator Stress")  # embedded title of the fixture
    file_id, version_before = ed["file"]["id"], ed["file"]["contentVersion"]
    path = media / "Rich Book.epub"
    before_raw, before_sha = raw_entries(path), hashlib.sha256(path.read_bytes()).hexdigest()
    report = {"fileId": file_id, "contentVersionBefore": version_before, "sha256Before": before_sha}

    report["writersBeforeEnable"] = stack.api("GET", "/admin/writers", tok)["items"]
    plan_try = None
    try:
        stack.api("POST", f"/admin/files/{file_id}/writebacks", tok, {"changes": {"title": "x"}})
    except SystemExit as e:  # api() exits on non-2xx; record the refusal text
        plan_try = str(e)
    report["planWhileDisabled"] = plan_try

    env = stack.env_for("unused", media)
    r = subprocess.run([str(stack.WORK / "bin" / ("ctl" + stack.EXE)), "writers", "enable", "epub", "--evidence", EVIDENCE], env=env, cwd=ROOT, capture_output=True, text=True)
    report["ctlEnable"] = (r.stdout + r.stderr).strip()
    r = subprocess.run([str(stack.WORK / "bin" / ("ctl" + stack.EXE)), "writers", "list"], env=env, cwd=ROOT, capture_output=True, text=True)
    report["ctlList"] = r.stdout.strip().splitlines()
    report["writersAfterEnable"] = stack.api("GET", "/admin/writers", tok)["items"]

    changes = {"title": "Rich Book (Retitled)", "authors": ["Ada Lovelace", "Grace Hopper"], "series_name": "Retitled Series", "series_index": 2}
    plan = stack.api("POST", f"/admin/files/{file_id}/writebacks", tok, {"changes": changes})
    report["plan"] = {k: plan[k] for k in ("id", "kind", "stage") if k in plan}
    stack.api("POST", f"/admin/writebacks/{plan['id']}/approve", tok, {})
    done = stack.api("POST", f"/admin/writebacks/{plan['id']}/execute", tok, {})
    report["executed"] = {k: done.get(k) for k in ("stage", "detail")}
    time.sleep(1)
    for _ in range(3):
        scan(tok, c["library"])

    after_raw, after_sha = raw_entries(path), hashlib.sha256(path.read_bytes()).hexdigest()
    other = {n for n in before_raw if n != "OEBPS/content.opf"}
    report["entriesChecked"] = len(before_raw)
    report["otherEntriesIdentical"] = all(before_raw[n] == after_raw[n] for n in other) and set(before_raw) == set(after_raw)
    report["opfChanged"] = before_raw["OEBPS/content.opf"] != after_raw["OEBPS/content.opf"]
    report["sha256After"] = after_sha
    with zipfile.ZipFile(path) as z:
        opf = z.read("OEBPS/content.opf").decode()
        report["firstEntry"] = [z.infolist()[0].filename, z.infolist()[0].compress_type]
    report["opfContainsNewValues"] = all(s in opf for s in ("Rich Book (Retitled)", "Ada Lovelace", "Grace Hopper", "Retitled Series"))
    ed2 = next(e for e in stack.api("GET", "/editions?size=50", tok)["items"] if e["id"] == ed["id"])
    report["contentVersionAfter"] = ed2["file"]["contentVersion"]
    report["sameFileIdentity"] = ed2["file"]["id"] == file_id
    report["titleAfter"] = next(t for t in stack.api("GET", "/titles?size=50", tok)["items"] if t["id"] == ed2["titleId"])
    report["catalogFollowsFile"] = report["titleAfter"]["title"] == "Rich Book (Retitled)" and report["titleAfter"]["authors"] == ["Ada Lovelace", "Grace Hopper"] and report["titleAfter"]["series"] == ["Retitled Series"]
    report["leftoverStagedFiles"] = [p.name for p in media.glob(".litara-write-*")]
    (OUT / "live-run.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    ok = report["otherEntriesIdentical"] and report["opfChanged"] and report["opfContainsNewValues"] and report["contentVersionAfter"] != version_before and report["sameFileIdentity"] and report["catalogFollowsFile"] and not report["leftoverStagedFiles"]
    print(json.dumps({k: report[k] for k in ("otherEntriesIdentical", "opfChanged", "opfContainsNewValues", "sameFileIdentity", "catalogFollowsFile", "leftoverStagedFiles")}), "versionChanged=", report["contentVersionAfter"] != version_before)
    print("LIVE CHECK", "OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


main()
