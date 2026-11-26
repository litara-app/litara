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
        "LITARA_CACHE_DIR": str(WORK / "cache"), "LITARA_SMTP_ALLOW_LOCAL_TEST": "1", "LITARA_PUBLIC_ORIGIN": BASE,
    })
    sk = WORK / "smtp.key"
    if sk.exists():  # the SMTP key ring is independent of the login secret key (ADR-0030 operator configuration)
        e.update({"LITARA_SMTP_KEYS": "k1:" + sk.read_text().strip(), "LITARA_SMTP_ACTIVE_KEY": "k1"})
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


def make_pdf(path: Path, title: str, pages: int = 6):
    """A minimal valid PDF whose page n says PAGE n, so a reader's current page is visible in a screenshot."""
    path.parent.mkdir(parents=True, exist_ok=True)
    objs = []
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(pages))
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>")
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i in range(pages):
        stream = f"BT /F1 96 Tf 80 600 Td (PAGE {i + 1}) Tj ET BT /F1 18 Tf 80 540 Td ({title} - page {i + 1} of {pages}) Tj ET"
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>")
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offsets:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))


def _png(width: int, height: int, rows) -> bytes:
    import struct, zlib
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def make_cbz(path: Path, pages: int = 5):
    """A CBZ whose page n shows n white blocks on a per-page colour (countable in a screenshot)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    colours = [(200, 60, 60), (60, 160, 70), (60, 90, 200), (190, 150, 40), (130, 60, 170), (40, 150, 160)]
    w, h = 400, 600
    with zipfile.ZipFile(path, "w") as z:
        for n in range(1, pages + 1):
            c = colours[(n - 1) % len(colours)]
            rows = []
            for y in range(h):
                row = []
                for x in range(w):
                    inblock = 60 <= y < 160 and any(40 + k * 60 <= x < 80 + k * 60 for k in range(n))
                    row += (255, 255, 255) if inblock else c
                rows.append(row)
            z.writestr(f"{n:03d}.png", _png(w, h, rows), compress_type=zipfile.ZIP_STORED)


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
    make_pdf(media / "Synthetic Author" / "Synthetic Paper.pdf", "Synthetic Paper")
    make_cbz(media / "Synthetic Author" / "Synthetic Comic.cbz")
    for name in ("server", "ctl"):
        run(["go", "build", "-o", str(WORK / "bin" / (name + EXE)), f"./cmd/{name}"], cwd=SERVER_DIR)
    psql(f"DROP DATABASE IF EXISTS {DB}")
    psql(f"CREATE DATABASE {DB}")
    key = subprocess.check_output([str(WORK / "bin" / ("ctl" + EXE)), "gen-key"], text=True).strip()
    (WORK / "smtp.key").write_text(subprocess.check_output([str(WORK / "bin" / ("ctl" + EXE)), "gen-key"], text=True).strip())
    (WORK / "secret.key").write_text(key)  # kept only so rehearsals can restart/restore with the same key; .tmp is git-ignored
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
    cfg = {"mode": "index", "rootPath": str(media), "followSymlinks": False, "stabilitySecs": 30, "writebackBackups": False, "providerOrder": []}
    lib = api("POST", "/admin/libraries", tok, {"name": "T007 Books", "config": cfg})["library"]["id"]
    api("PUT", f"/admin/users/{tp['user']['id']}/libraries/{lib}", tok)
    api("PUT", f"/admin/users/{reader['id']}/libraries/{lib}", tok)
    def scan():
        try:
            api("POST", f"/admin/libraries/{lib}/scans", tok, {})
        except SystemExit as e:  # a scheduled first scan may already be queued; that is as good
            if "scan_active" not in str(e):
                raise

    scan()  # the first observation
    time.sleep(31)  # stabilitySecs must pass between the two observations
    scan()  # catalogs the files
    (WORK / "creds.json").write_text(json.dumps({"base": BASE, "admin": ["t007admin", admin_pw], "reader": ["t007reader", user_pw], "library": lib}))
    for _ in range(60):
        eds = api("GET", "/editions?size=50", tok)
        if eds["total"] >= 4:
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
