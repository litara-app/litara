#!/usr/bin/env python3
"""Disposable seeded server for the Android instrumentation suites (litaraUrl / litaraPassword / litaraRecording / litaraAlternate).

  python scripts/t007/seed_stack.py up      # fresh database t007seed, `ctl seed` audio fixtures, server on :18090
  python scripts/t007/seed_stack.py down

Writes .tmp/t007/seed-args.json (git-ignored) with the generated synthetic password and the three-file recording id; nothing secret
is printed. Reuses the binaries and helpers of stack.py; needs the same Postgres container and ffmpeg on PATH.
"""
import json, os, re, secrets, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

stack.DB = "t007seed"
stack.PORT = int(os.environ.get("LITARA_T007_SEED_PORT", "18090"))
stack.BASE = f"http://127.0.0.1:{stack.PORT}"
stack.DB_URL = f"postgres://postgres:{stack.PG_PASS}@127.0.0.1:{stack.PG_PORT}/{stack.DB}?sslmode=disable"
SEED = stack.WORK / "seed"
PID = stack.WORK / "seed-server.pid"
ARGS = stack.WORK / "seed-args.json"
CTL = str(stack.WORK / "bin" / ("ctl" + stack.EXE))
SRV = str(stack.WORK / "bin" / ("server" + stack.EXE))


def down(quiet=False):
    if PID.exists():
        pid = int(PID.read_text())
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            try:
                os.kill(pid, 15)
            except OSError:
                pass
        PID.unlink()
    subprocess.run(["docker", "exec", stack.PG, "psql", "-U", "postgres", "-c", f"DROP DATABASE IF EXISTS {stack.DB} WITH (FORCE)"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not quiet:
        print("seed stack down")


def up():
    down(quiet=True)
    stack.WORK.mkdir(parents=True, exist_ok=True)
    for name in ("server", "ctl"):
        stack.run(["go", "build", "-o", str(stack.WORK / "bin" / (name + stack.EXE)), f"./cmd/{name}"], cwd=stack.SERVER_DIR)
    shutil.rmtree(SEED, ignore_errors=True)
    SEED.mkdir(parents=True)
    stack.psql(f"CREATE DATABASE {stack.DB}")
    key = subprocess.check_output([CTL, "gen-key"], text=True).strip()
    env = stack.env_for(key, SEED)
    env["LITARA_CACHE_DIR"] = str(stack.WORK / "seed-cache")
    stack.run([CTL, "migrate", "up"], env=env, stdout=subprocess.DEVNULL)
    pw = secrets.token_urlsafe(18)
    out = subprocess.run([CTL, "seed", "--dir", str(SEED), "--password-stdin"], env=env, input=pw + "\n", text=True, check=True, capture_output=True).stdout
    m = re.search(r"three-file=([0-9a-f-]{36})", out)
    alt = re.search(r"alternate=([0-9a-f-]{36})", out)
    if not m or not alt:
        raise SystemExit("could not read the three-file/alternate recording ids from ctl seed output")
    log = open(stack.WORK / "seed-server.log", "wb")
    proc = subprocess.Popen([SRV], env=env, stdout=log, stderr=subprocess.STDOUT)
    PID.write_text(str(proc.pid))
    for _ in range(60):
        try:
            urllib.request.urlopen(stack.BASE + "/readyz", timeout=2).read()
            break
        except Exception:
            time.sleep(1)
    else:
        raise SystemExit("seed server never became ready; see .tmp/t007/seed-server.log")
    ARGS.write_text(json.dumps({"litaraUrl": f"http://10.0.2.2:{stack.PORT}", "litaraPassword": pw, "litaraRecording": m.group(1), "litaraAlternate": alt.group(1)}))
    print(f"seed stack up on :{stack.PORT} (emulator http://10.0.2.2:{stack.PORT}); arguments in .tmp/t007/seed-args.json")


if __name__ == "__main__":
    {"up": up, "down": down}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
