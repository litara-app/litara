#!/usr/bin/env python3
"""Disposable local Litara stack for T007 device/emulator work (never touches a user's database).

  python scripts/t007/stack.py up      # build, fresh database, start server, seed library + synthetic EPUBs
  python scripts/t007/stack.py down    # stop the server it started and drop its database

Requires: go, docker with a running container whose name is in LITARA_T007_PG (default litara-t007-pg,
postgres superuser password in LITARA_T007_PG_PASSWORD, host port LITARA_T007_PG_PORT), and ffmpeg/ffprobe
on PATH (the server's startup check wants them even for an ebook-only library). State and the synthetic
accounts live in .tmp/t007/ (git-ignored). Synthetic credentials are generated per run and never printed.
"""
import json, os, secrets, shutil, subprocess, sys, time, urllib.request, urllib.error, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".tmp" / "t007"
SERVER_DIR = ROOT / "apps" / "server"
PG = os.environ.get("LITARA_T007_PG", "litara-t007-pg")
PG_PASS = os.environ.get("LITARA_T007_PG_PASSWORD", "t007pass")
PG_PORT = os.environ.get("LITARA_T007_PG_PORT", "55447")
DB = "t007android"
PORT = int(os.environ.get("LITARA_T007_PORT", "18407"))
BASE = f"http://127.0.0.1:{PORT}"
DB_URL = f"postgres://postgres:{PG_PASS}@127.0.0.1:{PG_PORT}/{DB}?sslmode=disable"
EXE = ".exe" if os.name == "nt" else ""


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def psql(sql):
    run(["docker", "exec", PG, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], stdout=subprocess.DEVNULL)


def env_for(key, media):
    e = dict(os.environ)
    e.update({
        "LITARA_DATABASE_URL": DB_URL, "LITARA_SECRET_KEY": key, "LITARA_DEV_INSECURE_HTTP": "1",
        "LITARA_HTTP_ADDR": f"0.0.0.0:{PORT}", "LITARA_MEDIA_ROOT": str(media),
        "LITARA_CACHE_DIR": str(WORK / "cache"),
    })
    return e


def api(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + "/api/v1" + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code} {e.read().decode()[:400]}")


PARAS = ("The reader turned the page and found, as promised, that the next chapter began exactly where the "
         "previous one had politely stopped. " * 6)


def make_epub(path: Path, title: str, author: str, uid: str, chapters: int = 8):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
                   compress_type=zipfile.ZIP_DEFLATED)
        items = "".join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(1, chapters + 1))
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(1, chapters + 1))
        z.writestr("OEBPS/content.opf",
                   '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
                   '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   f'<dc:identifier id="id">urn:uuid:{uid}</dc:identifier><dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:language>en</dc:language>'
                   '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>'
                   f'<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>{items}</manifest>'
                   f'<spine>{spine}</spine></package>', compress_type=zipfile.ZIP_DEFLATED)
        navli = "".join(f'<li><a href="c{i}.xhtml">Chapter {i}</a></li>' for i in range(1, chapters + 1))
        z.writestr("OEBPS/nav.xhtml",
                   '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
                   f'<head><title>Contents</title></head><body><nav epub:type="toc"><ol>{navli}</ol></nav></body></html>',
                   compress_type=zipfile.ZIP_DEFLATED)
        for i in range(1, chapters + 1):
            body = "".join(f"<p>{PARAS} (chapter {i}, paragraph {p})</p>" for p in range(1, 9))
            z.writestr(f"OEBPS/c{i}.xhtml",
                       '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>'
                       f'Chapter {i}</title></head><body><h1>Chapter {i}</h1>{body}</body></html>', compress_type=zipfile.ZIP_DEFLATED)


def up():
    down(quiet=True)
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / "bin").mkdir(exist_ok=True)
    media = WORK / "media"
    shutil.rmtree(media, ignore_errors=True)
    shutil.rmtree(WORK / "cache", ignore_errors=True)
    media.mkdir(parents=True)
    make_epub(media / "Synthetic Author" / "Synthetic Tale.epub", "Synthetic Tale", "Synthetic Author", "00000000-0000-4000-8000-0000000000a1")
    make_epub(media / "Synthetic Author" / "Second Tale.epub", "Second Tale", "Synthetic Author", "00000000-0000-4000-8000-0000000000a2", chapters=3)
    for name in ("server", "ctl"):
        run(["go", "build", "-o", str(WORK / "bin" / (name + EXE)), f"./cmd/{name}"], cwd=SERVER_DIR)
    psql(f"DROP DATABASE IF EXISTS {DB}")
    psql(f"CREATE DATABASE {DB}")
    key = subprocess.check_output([str(WORK / "bin" / ("ctl" + EXE)), "gen-key"], text=True).strip()
    env = env_for(key, media)
    run([str(WORK / "bin" / ("ctl" + EXE)), "migrate", "up"], env=env, stdout=subprocess.DEVNULL)
    admin_pw, user_pw = secrets.token_urlsafe(18), secrets.token_urlsafe(18)
    run([str(WORK / "bin" / ("ctl" + EXE)), "bootstrap-admin", "--username", "t007admin"], env=env, input=admin_pw + "\n", text=True, stdout=subprocess.DEVNULL)
    log = open(WORK / "server.log", "wb")
    proc = subprocess.Popen([str(WORK / "bin" / ("server" + EXE))], env=env, stdout=log, stderr=subprocess.STDOUT)
    (WORK / "server.pid").write_text(str(proc.pid))
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/readyz", timeout=2).read()
            break
        except Exception:
            time.sleep(1)
    else:
        raise SystemExit("server never became ready; see .tmp/t007/server.log")
    tp = api("POST", "/auth/native/login", body={"username": "t007admin", "password": admin_pw, "deviceName": "t007-setup"})
    tok = tp["accessToken"]
    reader = api("POST", "/admin/users", tok, {"username": "t007reader", "displayName": "T007 Reader", "password": user_pw, "isAdmin": False})
    cfg = {"mode": "index", "rootPath": str(media), "followSymlinks": False, "stabilitySecs": 1, "writebackBackups": False, "providerOrder": []}
    lib = api("POST", "/admin/libraries", tok, {"name": "T007 Books", "config": cfg})["library"]["id"]
    api("PUT", f"/admin/users/{tp['user']['id']}/libraries/{lib}", tok)
    api("PUT", f"/admin/users/{reader['id']}/libraries/{lib}", tok)
    time.sleep(2)  # files must be older than stabilitySecs
    api("POST", f"/admin/libraries/{lib}/scans", tok, {})
    (WORK / "creds.json").write_text(json.dumps({"base": BASE, "admin": ["t007admin", admin_pw], "reader": ["t007reader", user_pw], "library": lib}))
    for _ in range(60):
        eds = api("GET", "/editions?size=50", tok)
        if eds["total"] >= 2:
            break
        time.sleep(1)
    print(f"stack up: {BASE} (emulator: http://10.0.2.2:{PORT}); {eds['total']} editions; credentials in .tmp/t007/creds.json")


def down(quiet=False):
    pidf = WORK / "server.pid"
    if pidf.exists():
        pid = int(pidf.read_text())
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            try:
                os.kill(pid, 15)
            except OSError:
                pass
        pidf.unlink()
    subprocess.run(["docker", "exec", PG, "psql", "-U", "postgres", "-c", f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not quiet:
        print("stack down")


if __name__ == "__main__":
    {"up": up, "down": down}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
