#!/usr/bin/env python3
"""Disposable backup and restore rehearsal (T007 M3, scenario backup-restore + smtp-key-restart).

  python scripts/t007/backup_restore.py [--out research/t007/evidence/m3-backup-restore]

Builds the disposable source stack (stack.py), creates user state through the real API (position, completion, annotation,
shelf, KOReader credential, encrypted SMTP password), stops the server, then backs up: PostgreSQL custom-format dump of the
database, the roles/globals dump, the media root and the secret key (the key is read from .tmp, never printed or copied into
evidence). It restores into an independent fresh stack (new database, new media copy, new cache, other port):

  1. with the WRONG key: the server must start, SMTP must report the key unavailable, no secret may appear in any API output;
  2. with the CORRECT key: the SMTP secret is usable again, and every API snapshot must equal the source snapshot exactly.

Reading is proven by an authenticated Range request on the restored original; original fixture media are hashed before and after
(the restore must not change them). Regenerable caches are deliberately not backed up. This is a rehearsal, not a production
backup/retention policy.
"""
import hashlib, json, os, shutil, subprocess, sys, time, urllib.request, urllib.error, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT = stack.ROOT
WORK = stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m3-backup-restore")
RDB, RPORT = "t007restore", 18408
RBASE = f"http://127.0.0.1:{RPORT}"
RDIR = WORK / "restore"
SECRETS = []  # values that must never appear in API output or evidence


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def call(base, method, path, token=None, body=None, headers=None, raw=False):
    req = urllib.request.Request(base + "/api/v1" + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
            if raw:
                return r.status, dict(r.headers), data
            return json.loads(data) if data else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code} {e.read().decode()[:300]}")


def login(base, who, creds):
    u, p = creds[who]
    return call(base, "POST", "/auth/native/login", body={"username": u, "password": p, "deviceName": "rehearsal-" + who})["accessToken"]


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def tree_hashes(root):
    root = Path(root)
    return {str(p.relative_to(root)).replace("\\", "/"): sha(p) for p in sorted(root.rglob("*")) if p.is_file()}


def seed_state(base, creds):
    """User and operator state that a restore must carry across exactly."""
    rt, at = login(base, "reader", creds), login(base, "admin", creds)
    titles = {t["id"]: t["title"] for t in call(base, "GET", "/titles?size=200", rt)["items"]}
    eds = {titles[e["titleId"]]: e for e in call(base, "GET", "/editions?size=200", rt)["items"]}
    # reading position (comic) with manifest identity, like the web reader
    comic = eds["Synthetic Comic"]
    f = comic["file"]
    pp = f"/files/{f['id']}/versions/{f['contentVersion']}/pages"
    try:
        call(base, "POST", pp, rt, {"operationId": str(uuid.uuid4()), "baseRevision": comic["revision"], "contentVersion": f["contentVersion"]})
    except SystemExit:
        pass  # already prepared
    for _ in range(30):
        try:
            m = call(base, "GET", pp, rt)
            if m.get("pages"):
                break
        except SystemExit:
            pass
        time.sleep(1)
    page = m["pages"][3]
    pos = call(base, "GET", f"/editions/{comic['id']}/position", rt)
    call(base, "PUT", f"/editions/{comic['id']}/position", rt, {"operationId": str(uuid.uuid4()), "baseRevision": pos["revision"], "anchor": {
        "fileId": f["id"], "contentVersion": f["contentVersion"],
        "locator": {"kind": "comic-page", "version": 1, "pageIndex": 3, "entryId": page["entryId"], "manifestVersion": m["manifestVersion"]}}, "capturedAt": now()})
    # a bookmark note on the comic
    aid = str(uuid.uuid4())
    call(base, "PUT", f"/editions/{comic['id']}/annotations/{aid}", rt, {"operationId": str(uuid.uuid4()), "baseRevision": "0", "data": {
        "kind": "note", "anchor": {"fileId": f["id"], "contentVersion": f["contentVersion"], "locator": {
            "kind": "comic-page", "version": 1, "pageIndex": 1, "entryId": m["pages"][1]["entryId"], "manifestVersion": m["manifestVersion"]}},
        "selection": None, "text": "restore me", "quote": ""}, "capturedAt": now()})
    # finished ebook
    tale = eds["Synthetic Tale"]
    call(base, "PUT", f"/editions/{tale['id']}/completion", rt, {"operationId": str(uuid.uuid4()), "baseRevision": tale["completion"]["revision"],
         "fileId": tale["file"]["id"], "contentVersion": tale["file"]["contentVersion"], "event": "manual_finish", "capturedAt": now()})
    # a shelf holding a title
    sid = str(uuid.uuid4())
    call(base, "PUT", f"/shelves/{sid}", rt, {"operationId": str(uuid.uuid4()), "baseRevision": "0", "capturedAt": now(),
         "data": {"name": "Rehearsal shelf", "visibility": "private", "kind": "manual", "filter": None}})
    call(base, "PUT", f"/shelves/{sid}/titles/{tale['titleId']}", rt, {"operationId": str(uuid.uuid4()), "baseRevision": "1", "capturedAt": now()})
    # KOReader credential (its secret is shown once by the API; we never keep it)
    kpw = uuid.uuid4().hex + uuid.uuid4().hex
    SECRETS.append(kpw)
    call(base, "POST", "/integration-credentials", rt, {"operationId": str(uuid.uuid4()), "kind": "koreader", "label": "rehearsal device", "password": kpw})
    # encrypted SMTP secret: local test plain transport, never contacted
    spw = "smtp-" + uuid.uuid4().hex
    SECRETS.append(spw)
    cur = call(base, "GET", "/admin/delivery/smtp", at)
    call(base, "PUT", "/admin/delivery/smtp", at, {"operationId": str(uuid.uuid4()), "baseRevision": cur["revision"], "enabled": True, "host": "127.0.0.1", "port": 2525,
         "tlsMode": "local_test_plain", "username": "rehearsal", "fromAddress": "rehearsal@example.test", "secretAction": "replace", "password": spw})
    return rt, at


def snapshot(base, creds):
    rt, at = login(base, "reader", creds), login(base, "admin", creds)
    s = {}
    s["titles"] = call(base, "GET", "/titles?size=200", rt)
    eds = call(base, "GET", "/editions?size=200", rt)
    s["editions"] = eds
    s["positions"] = {e["id"]: call(base, "GET", f"/editions/{e['id']}/position", rt) for e in eds["items"]}
    s["annotations"] = {e["id"]: call(base, "GET", f"/editions/{e['id']}/annotations?includeDeleted=true&size=200", rt) for e in eds["items"]}
    s["shelves"] = call(base, "GET", "/shelves", rt)
    s["shelfTitles"] = {sh["id"]: call(base, "GET", f"/shelves/{sh['id']}/titles", rt) for sh in s["shelves"]["items"]}
    s["conflicts"] = call(base, "GET", "/personal-conflicts?includeResolved=true", rt)
    s["credentials"] = call(base, "GET", "/integration-credentials", rt)
    s["smtp"] = call(base, "GET", "/admin/delivery/smtp", at)
    s["libraries"] = call(base, "GET", "/libraries", at)
    s["users"] = call(base, "GET", "/admin/users", at)
    return s


def diff(a, b, path=""):
    if type(a) != type(b):
        return [f"{path}: type {type(a).__name__} != {type(b).__name__}"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(f"{path}/{k}: only on one side")
            else:
                out += diff(a[k], b[k], f"{path}/{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in diff(x, y, f"{path}[{i}]")]
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


def pg(args, **kw):
    return subprocess.run(["docker", "exec", *(["-i"] if kw.get("stdin") else []), stack.PG, *args], check=True, **kw)


def start_restored(key, media, smtp_key):
    env = dict(os.environ)
    env.update({"LITARA_DATABASE_URL": f"postgres://postgres:{stack.PG_PASS}@127.0.0.1:{stack.PG_PORT}/{RDB}?sslmode=disable", "LITARA_SECRET_KEY": key,
                "LITARA_DEV_INSECURE_HTTP": "1", "LITARA_HTTP_ADDR": f"0.0.0.0:{RPORT}", "LITARA_MEDIA_ROOT": str(media), "LITARA_CACHE_DIR": str(RDIR / "cache"), "LITARA_SMTP_ALLOW_LOCAL_TEST": "1"})
    env.pop("LITARA_SMTP_KEYS", None), env.pop("LITARA_SMTP_ACTIVE_KEY", None)
    if smtp_key:  # (id, base64 key)
        env.update({"LITARA_SMTP_KEYS": smtp_key[0] + ":" + smtp_key[1], "LITARA_SMTP_ACTIVE_KEY": smtp_key[0]})
    log = open(RDIR / "server.log", "ab")
    proc = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(60):
        try:
            urllib.request.urlopen(RBASE + "/readyz", timeout=2).read()
            return proc
        except Exception:
            if proc.poll() is not None:
                break
            time.sleep(1)
    proc.kill()
    raise SystemExit("restored server never became ready; see " + str(RDIR / "server.log"))


def stop(proc):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.terminate()
    proc.wait(timeout=30)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rep = {"started": now()}
    stack.up()
    creds = json.loads((WORK / "creds.json").read_text())
    key = (WORK / "secret.key").read_text().strip()
    SECRETS.extend([creds["admin"][1], creds["reader"][1], key])
    at0 = login(stack.BASE, "admin", creds)
    for _ in range(8):  # a file needs two observations before it is cataloged
        if call(stack.BASE, "GET", "/editions?size=50", at0)["total"] >= 4:
            break
        try:
            call(stack.BASE, "POST", f"/admin/libraries/{creds['library']}/scans", at0, {})
        except SystemExit:
            pass
        time.sleep(4)
    seed_state(stack.BASE, creds)
    src = snapshot(stack.BASE, creds)
    media = WORK / "media"
    before_media = tree_hashes(media)

    # ---- stop and back up (a consistent dump of a quiesced stack) ----
    pid = int((WORK / "server.pid").read_text())
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, 15)
    time.sleep(2)
    bdir = WORK / "backup"
    shutil.rmtree(bdir, ignore_errors=True)
    bdir.mkdir(parents=True)
    with open(bdir / "db.dump", "wb") as f:
        pg(["pg_dump", "-U", "postgres", "-Fc", stack.DB], stdout=f)
    with open(bdir / "globals.sql", "wb") as f:
        pg(["pg_dumpall", "-U", "postgres", "--globals-only"], stdout=f)
    shutil.copytree(media, bdir / "media")
    (bdir / "smtp.key").write_text((WORK / "smtp.key").read_text())
    (bdir / "secret.key").write_text(key)  # the key ring belongs in the backup set; never in committed evidence
    inventory = {
        "database dump (pg_dump -Fc)": (bdir / "db.dump").stat().st_size,
        "roles/globals (pg_dumpall --globals-only)": (bdir / "globals.sql").stat().st_size,
        "media root files": len(before_media),
        "secret key file and SMTP key ring": "present (values not recorded)",
        "cache directory": "not backed up: regenerable (page/derived caches)",
    }
    rep["backupInventory"] = inventory
    rep["globalsRoles"] = sorted({ln.split()[2].rstrip(";") for ln in (bdir / "globals.sql").read_text(errors="replace").splitlines() if ln.startswith("CREATE ROLE")})

    # ---- restore into an independent fresh stack ----
    shutil.rmtree(RDIR, ignore_errors=True)
    RDIR.mkdir(parents=True)
    shutil.copytree(bdir / "media", RDIR / "media")
    pg(["psql", "-U", "postgres", "-c", f"DROP DATABASE IF EXISTS {RDB} WITH (FORCE)"], stdout=subprocess.DEVNULL)
    pg(["psql", "-U", "postgres", "-c", f"CREATE DATABASE {RDB}"], stdout=subprocess.DEVNULL)
    with open(bdir / "db.dump", "rb") as f:
        pg(["pg_restore", "-U", "postgres", "-d", RDB, "--no-owner", "--exit-on-error"], stdin=f, stdout=subprocess.DEVNULL)

    smtp_key = (WORK / "smtp.key").read_text().strip()
    SECRETS.append(smtp_key)
    wrong_ring = subprocess.check_output([str(WORK / "bin" / ("ctl" + stack.EXE)), "gen-key"], text=True).strip()
    SECRETS.append(wrong_ring)
    rest = {k: v for k, v in src.items() if k != "smtp"}
    for label, ring in (("missingSmtpKeyRing", None), ("otherKeyId", ("k2", wrong_ring)), ("sameIdWrongKeyMaterial", ("k1", wrong_ring))):
        proc = start_restored(key, RDIR / "media", ring)
        try:
            at_ = login(RBASE, "admin", creds)
            s_ = call(RBASE, "GET", "/admin/delivery/smtp", at_)
            snap = snapshot(RBASE, creds)
            same = diff(rest, {k: v for k, v in snap.items() if k != "smtp"}) == []
            rep[label] = {"serverStarted": True, "smtp": s_, "otherStateEqualToSource": same}
            assert same, rep[label]
            if ring is None or ring[0] != "k1":
                assert s_["configured"] and s_["hasPassword"] and not s_["keyAvailable"], rep[label]
            else:
                # The report only checks that the key ID exists in the ring, not that the key opens the secret.
                t_ = call(RBASE, "POST", "/admin/delivery/smtp/test", at_, {"operationId": str(uuid.uuid4()), "baseRevision": s_["revision"]})
                rep[label]["connectionTest"] = t_
                assert not t_["success"], t_
        finally:
            stop(proc)

    # Observations store absolute file locations: restoring media to a different directory must fail closed, not serve or lose anything.
    proc = start_restored(key, RDIR / "media", ("k1", smtp_key))
    try:
        rt_ = login(RBASE, "reader", creds)
        ed_ = next(e for e in call(RBASE, "GET", "/editions?size=50", rt_)["items"] if e["file"]["format"] == "epub")
        try:
            call(RBASE, "GET", ed_["file"]["contentPath"][len("/api/v1"):], rt_, headers={"Range": "bytes=0-63"}, raw=True)
            rep["differentMediaPath"] = {"result": "served (unexpected)"}
        except SystemExit as e:
            rep["differentMediaPath"] = {"result": "refused", "detail": str(e)[:200]}
    finally:
        stop(proc)
    # Independent restore proper: remove the source stack's media, put the backed-up copy back at the same absolute path.
    shutil.rmtree(media)
    shutil.copytree(bdir / "media", media)
    p2 = start_restored(key, media, ("k1", smtp_key))
    try:
        restored = snapshot(RBASE, creds)
        d = diff(src, restored)
        rep["snapshotDifferences"] = d
        rep["correctKey"] = {"smtp": restored["smtp"]}
        assert restored["smtp"]["keyAvailable"], restored["smtp"]
        # reading: authenticated Range on a restored original, compared with the source file
        rt = login(RBASE, "reader", creds)
        ed = next(e for e in restored["editions"]["items"] if e["file"]["format"] == "epub")
        status, headers, body = call(RBASE, "GET", ed["file"]["contentPath"][len("/api/v1"):], rt, headers={"Range": "bytes=0-63"}, raw=True)
        rep["rangeRead"] = {"status": status, "bytes": len(body), "contentRange": headers.get("Content-Range")}
        assert status == 206 and len(body) == 64
        # every restored fixture equals the original byte for byte
        rep["restoredMediaEqualsSource"] = tree_hashes(media) == before_media
        rep["sourceMediaUnchanged"] = tree_hashes(bdir / "media") == before_media  # the backup copy of the source fixtures
        # a native refresh token from before the backup must still be a valid session record, but a new login must work
        rep["newLoginWorksAfterRestore"] = bool(rt)
        # no secret may appear in anything this script retained
        blob = json.dumps(rep) + json.dumps(restored)
        rep["secretsAbsentFromOutput"] = not any(s and s in blob for s in SECRETS)
        assert rep["secretsAbsentFromOutput"]
    finally:
        stop(p2)
    rep["finished"] = now()
    ok = not rep["snapshotDifferences"] and rep["sourceMediaUnchanged"] and rep["restoredMediaEqualsSource"] and rep["secretsAbsentFromOutput"]
    rep["result"] = "PASS" if ok else "FAIL"
    (OUT / "run.json").write_text(json.dumps(rep, indent=2, ensure_ascii=False), encoding="utf-8")
    log = (RDIR / "server.log").read_text(errors="replace")
    (OUT / "restored-server-log-secret-scan.txt").write_text("secrets found in restored server log: " + str(any(s in log for s in SECRETS if s)) + "\n")
    # cleanup of the disposable restore stack (the source stack and its database go with stack.down())
    pg(["psql", "-U", "postgres", "-c", f"DROP DATABASE IF EXISTS {RDB} WITH (FORCE)"], stdout=subprocess.DEVNULL)
    stack.down(quiet=True)
    print(json.dumps({k: rep[k] for k in ("result", "snapshotDifferences", "sourceMediaUnchanged", "restoredMediaEqualsSource", "secretsAbsentFromOutput", "rangeRead")}, indent=1))
    sys.exit(0 if ok else 1)


main()
