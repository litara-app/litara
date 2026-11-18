#!/usr/bin/env python3
"""Synthetic audio corpus through the real stack (T007 M4, scenario corpus-capabilities / G09).

  python scripts/t007/audio_corpus.py [--out research/t007/evidence/m4-corpus] [--keep]

Generates 20 s fixtures with ffmpeg (MP3, M4A, FLAC, Ogg Vorbis, Opus, WAV, ADTS AAC), a 30 s M4B with three embedded chapters
and a three-part MP3 recording, lets the disposable server catalog them, and checks per recording: readiness, play/download
capability, ffprobe duration, authenticated original HEAD and Range (206 with the exact bytes of the file on disk), a tail Range,
and chapter handling. Results go to audio-corpus.json. With --keep the stack stays up for follow-up playback checks.
"""
import hashlib, json, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m4-corpus")
SPECS = [("mp3", ["-c:a", "libmp3lame", "-b:a", "64k"], "mp3"), ("m4a", ["-c:a", "aac", "-b:a", "64k"], "m4a"), ("flac", ["-c:a", "flac"], "flac"),
         ("ogg", ["-c:a", "libvorbis", "-b:a", "64k"], "ogg"), ("opus", ["-c:a", "libopus", "-b:a", "48k"], "opus"), ("wav", ["-c:a", "pcm_s16le"], "wav"),
         ("aac", ["-c:a", "aac", "-b:a", "64k", "-f", "adts"], "aac")]


def ff(*a):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)


def http(url, tok, method="GET", rng=None):
    req = urllib.request.Request(url, method=method, headers={"Authorization": "Bearer " + tok, **({"Range": rng} if rng else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict((k.lower(), v) for k, v in r.getheaders()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict((k.lower(), v) for k, v in e.headers.items()), e.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    M = WORK / "media" / "Audio Author"
    for name, args, ext in SPECS:
        d = M / f"Format {name.upper()}"
        d.mkdir(parents=True, exist_ok=True)
        ff("-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-metadata", f"title=Format {name.upper()}", "-metadata", "artist=Audio Author", "-metadata", f"album=Format {name.upper()}", *args, str(d / f"book.{ext}"))
    d = M / "Chaptered M4B"
    d.mkdir(exist_ok=True)
    meta = d / "meta.txt"
    meta.write_text(";FFMETADATA1\ntitle=Chaptered M4B\nartist=Audio Author\nalbum=Chaptered M4B\n" + "".join(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={i * 10000}\nEND={(i + 1) * 10000}\ntitle={n}\n" for i, n in enumerate(("One", "Two", "Three"))))
    ff("-f", "lavfi", "-i", "sine=frequency=330:duration=30", "-i", str(meta), "-map_metadata", "1", "-map_chapters", "1", "-c:a", "aac", "-b:a", "48k", "-f", "ipod", str(d / "book.m4b"))
    meta.unlink()
    d2 = M / "Multi File MP3"
    d2.mkdir(exist_ok=True)
    for i in (1, 2, 3):
        ff("-f", "lavfi", "-i", f"sine=frequency={300 + i * 50}:duration=8", "-metadata", "title=Multi File MP3", "-metadata", "album=Multi File MP3", "-metadata", "artist=Audio Author", "-metadata", f"track={i}/3", "-c:a", "libmp3lame", "-b:a", "48k", str(d2 / f"part{i}.mp3"))
    adm = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "audio-corpus"})["accessToken"]
    for _ in range(8):
        try:
            stack.api("POST", f"/admin/libraries/{c['library']}/scans", adm, {})
        except SystemExit:
            pass
        time.sleep(5)
        if len([r for r in stack.api("GET", "/recordings?size=50", adm)["items"] if r["readiness"] == "ready"]) >= 9:
            break
    out, bad = {}, []
    for r in stack.api("GET", "/recordings?size=50", adm)["items"]:
        d = stack.api("GET", f"/recordings/{r['id']}", adm)
        f = d["files"][0]
        disk = next((M / r["title"]).glob(Path(f["filename"]).name))
        data = disk.read_bytes()
        url = stack.BASE + f["contentPath"]
        hs, hh, _ = http(url, adm, "HEAD")
        s1, h1, b1 = http(url, adm, rng="bytes=100-199")
        n = len(data)
        s2, h2, b2 = http(url, adm, rng=f"bytes={n - 50}-")
        row = dict(readiness=d["readiness"], mime=f["mimeType"], files=len(d["files"]), durationMs=d["durationMs"], sizeBytes=f["sizeBytes"],
                   play=d["capabilities"]["play"], download=d["capabilities"]["download"], wholeRecordingSeek=d["capabilities"]["wholeRecordingSeek"],
                   issues=[i["code"] for i in d["issues"]], chapters=[(x["label"], x["recordingStartMs"], x["source"]) for x in d["chapters"]],
                   head=hs, headLength=hh.get("content-length"), range206=s1 == 206, rangeBytesExact=b1 == data[100:200], tailRange206=s2 == 206, tailBytesExact=b2 == data[n - 50:],
                   sha256=hashlib.sha256(data).hexdigest()[:16])
        out[r["title"]] = row
        ok = row["readiness"] == "ready" and row["play"] and row["download"] and row["head"] == 200 and row["range206"] and row["rangeBytesExact"] and row["tailRange206"] and row["tailBytesExact"] and abs(row["durationMs"] - {"Chaptered M4B": 30000, "Multi File MP3": 24000}.get(r["title"], 20000)) < (500 if r["title"] == "Format AAC" else 100)  # raw ADTS has no duration header; ffprobe estimates it
        if not ok:
            bad.append(r["title"])
    exp = {f"Format {n.upper()}" for n, _, _ in SPECS} | {"Chaptered M4B", "Multi File MP3"}
    missing = sorted(exp - set(out))
    chap_ok = [x[0] for x in out.get("Chaptered M4B", {}).get("chapters", [])] == ["One", "Two", "Three"] and all(x[2] == "embedded" for x in out["Chaptered M4B"]["chapters"])
    multi_ok = out.get("Multi File MP3", {}).get("files") == 3
    rep = {"recordings": out, "failures": bad, "missing": missing, "embeddedChaptersOk": chap_ok, "multiFileOk": multi_ok}
    rep["result"] = "PASS" if not bad and not missing and chap_ok and multi_ok else "FAIL"
    (OUT / "audio-corpus.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("result", "failures", "missing", "embeddedChaptersOk", "multiFileOk")}), len(out), "recordings")
    if "--keep" not in sys.argv:
        stack.down(quiet=True)
    sys.exit(0 if rep["result"] == "PASS" else 1)


main()
