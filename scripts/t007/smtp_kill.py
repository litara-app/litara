#!/usr/bin/env python3
"""SMTP submission-boundary process-death rehearsal (T007 M3, scenario process-restart).

  python scripts/t007/smtp_kill.py [--out research/t007/evidence/m3-smtp-kill]

A local sink on 127.0.0.1:2525 (synthetic recipient, no external mail) accepts a message up to and including the end of DATA
and then never answers, which leaves the server exactly at the submission boundary. The real server process is killed there.
After restart the delivery ledger must settle at outcome_unknown and the sink must never receive a second copy, however long
we wait past the lease; a resend must be refused unless the operator acknowledges a possible duplicate.
"""
import json, os, socket, subprocess, sys, threading, time, uuid, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m3-smtp-kill")
PORT = 2525
received = []  # one entry per message that reached the end of DATA
hold = threading.Event()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def serve(sock):
    while True:
        try:
            conn, _ = sock.accept()
        except OSError:
            return
        threading.Thread(target=handle, args=(conn,), daemon=True).start()


def handle(conn):
    f = conn.makefile("rwb", buffering=0)
    try:
        f.write(b"220 sink ready\r\n")
        data_mode = False
        size = 0
        while True:
            line = f.readline()
            if not line:
                return
            if data_mode:
                size += len(line)
                if line == b".\r\n":
                    received.append({"at": now(), "bytes": size})
                    hold.set()
                    time.sleep(3600)  # never answer: the submission outcome stays unknown to the server
                    return
                continue
            cmd = line[:4].upper()
            if cmd in (b"EHLO", b"HELO"):
                f.write(b"250-sink\r\n250 8BITMIME\r\n")
            elif cmd in (b"MAIL", b"RCPT", b"RSET", b"NOOP"):
                f.write(b"250 ok\r\n")
            elif cmd == b"DATA":
                f.write(b"354 go\r\n")
                data_mode = True
            elif cmd == b"QUIT":
                f.write(b"221 bye\r\n")
                return
            else:
                f.write(b"250 ok\r\n")
    except OSError:
        return


def kill(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, 9)


def sql(q):
    r = subprocess.run(["docker", "exec", stack.PG, "psql", "-U", "postgres", "-d", stack.DB, "-At", "-c", q], capture_output=True, text=True, check=True)
    return r.stdout.strip()


def start():
    env = stack.env_for((WORK / "secret.key").read_text().strip(), WORK / "media")
    proc = subprocess.Popen([str(WORK / "bin" / ("server" + stack.EXE))], env=env, stdout=open(WORK / "server.log", "ab"), stderr=subprocess.STDOUT)
    (WORK / "server.pid").write_text(str(proc.pid))
    for _ in range(60):
        try:
            import urllib.request
            urllib.request.urlopen(stack.BASE + "/readyz", timeout=2).read()
            return proc
        except Exception:
            time.sleep(1)
    raise SystemExit("server not ready")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rep = {"started": now()}
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", PORT))
    sock.listen(5)
    threading.Thread(target=serve, args=(sock,), daemon=True).start()
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    adm = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "smtp-kill-a"})["accessToken"]
    for _ in range(8):
        eds = stack.api("GET", "/editions?size=50", adm)["items"]
        if len(eds) >= 4:
            break
        try:
            stack.api("POST", f"/admin/libraries/{c['library']}/scans", adm, {})
        except SystemExit:
            pass
        time.sleep(4)
    ed = next(e for e in eds if e["file"]["format"] == "epub")
    cur = stack.api("GET", "/admin/delivery/smtp", adm)
    stack.api("PUT", "/admin/delivery/smtp", adm, {"operationId": str(uuid.uuid4()), "baseRevision": cur["revision"], "enabled": True, "host": "127.0.0.1", "port": PORT,
              "tlsMode": "local_test_plain", "username": "", "fromAddress": "litara@example.test", "secretAction": "clear", "password": None})
    ist = stack.api("GET", "/integrations/settings", adm)
    stack.api("PUT", "/admin/integrations/settings", adm, {"operationId": str(uuid.uuid4()), "baseRevision": ist["revision"], "opdsEnabled": ist["opdsEnabled"], "emailEnabled": True,
              "koreaderEnabled": ist["koreaderEnabled"], "maxAttachmentBytes": ist["maxAttachmentBytes"], "maxDeliveriesPerUserPerHour": ist["maxDeliveriesPerUserPerHour"]})
    rid = str(uuid.uuid4())
    rec = stack.api("PUT", f"/admin/delivery/recipients/{rid}", adm, {"operationId": str(uuid.uuid4()), "baseRevision": "0", "data": {"name": "Sink", "address": "reader@example.test"}}) \
        if False else None
    rt = stack.api("POST", "/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "smtp-kill-r"})["accessToken"]
    rec = stack.api("PUT", f"/delivery/recipients/{rid}", rt, {"operationId": str(uuid.uuid4()), "baseRevision": "0", "data": {"name": "Sink", "address": "reader@example.test"}})
    tr = stack.api("GET", "/delivery/transports", rt)
    body = {"operationId": str(uuid.uuid4()), "fileId": ed["file"]["id"], "contentVersion": ed["file"]["contentVersion"], "recipientId": rid,
            "recipientRevision": rec["revision"], "transport": "server", "transportRevision": tr["server"]["revision"], "resendOf": None, "acknowledgePossibleDuplicate": False}
    d = stack.api("POST", "/deliveries", rt, body)
    rep["deliveryId"] = d["id"]
    if not hold.wait(60):
        raise SystemExit("sink never reached the end of DATA; delivery state " + sql("SELECT state FROM deliveries"))
    rep["stateAtKill"] = sql("SELECT state, attempts, attempt_open FROM deliveries")
    kill(int((WORK / "server.pid").read_text()))
    t_kill = time.time()
    rep["messagesBeforeRestart"] = len(received)
    time.sleep(1)
    rep["stateAfterDeath"] = sql("SELECT state, attempts, attempt_open FROM deliveries")
    proc = start()
    seq = []
    for _ in range(150):  # up to ~5 minutes: lease (send timeout + 30 s) plus the one-minute recovery sweep
        st = sql("SELECT state || '/' || attempts FROM deliveries")
        if not seq or seq[-1][1] != st:
            seq.append((round(time.time() - t_kill, 1), st))
        if st.startswith("outcome_unknown"):
            break
        time.sleep(2)
    rep["stateSequenceAfterKill"] = seq
    time.sleep(70)  # past a further full recovery sweep: nothing may resubmit
    rep["finalState"] = sql("SELECT state, attempts, code FROM deliveries")
    rep["messagesReceivedBySink"] = len(received)
    # a resend without acknowledging the possible duplicate must be refused
    try:
        stack.api("POST", "/deliveries", rt, {**body, "operationId": str(uuid.uuid4()), "resendOf": d["id"], "acknowledgePossibleDuplicate": False})
        rep["resendWithoutAcknowledgement"] = "accepted (unexpected)"
    except SystemExit as e:
        rep["resendWithoutAcknowledgement"] = str(e)[:240]
    ok = rep["finalState"].startswith("outcome_unknown") and rep["messagesReceivedBySink"] == 1 and "unexpected" not in rep["resendWithoutAcknowledgement"]
    rep["result"] = "PASS" if ok else "FAIL"
    rep["finished"] = now()
    (OUT / "run.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    kill(proc.pid)
    stack.down(quiet=True)
    print(json.dumps(rep, indent=1))
    sys.exit(0 if ok else 1)


main()
