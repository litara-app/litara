#!/usr/bin/env python3
"""A second API client for the disposable T007 stack: acts as the synthetic reader from another device.

  python scripts/t007/second_client.py state                 # editions with completion revision/finished + unresolved conflicts
  python scripts/t007/second_client.py finish   "Title"      # manual_finish using the CURRENT revision (a well-behaved second device)
  python scripts/t007/second_client.py unfinish "Title"
  python scripts/t007/second_client.py comic-page "Title" 4   # save a comic position (zero-based page) like the web reader

Credentials come from .tmp/t007/creds.json written by stack.py; they are never printed.
"""
import json, sys, urllib.request, urllib.error, uuid, datetime
from pathlib import Path

CREDS = json.loads((Path(__file__).resolve().parents[2] / ".tmp" / "t007" / "creds.json").read_text())
BASE = CREDS["base"] + "/api/v1"


def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code} {e.read().decode()[:300]}")


def token():
    u, p = CREDS["reader"]
    return call("POST", "/auth/native/login", body={"username": u, "password": p, "deviceName": "second-device"})["accessToken"]


def editions(tok):
    titles = {t["id"]: t["title"] for t in call("GET", "/titles?size=200", tok)["items"]}
    return [(titles.get(e["titleId"], e["label"]), e) for e in call("GET", "/editions?size=200", tok)["items"]]


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    tok = token()
    if cmd == "state":
        for title, e in editions(tok):
            c = e["completion"]
            print(f"{title}: completion rev {c['revision']} finished={c['finished']}  edition={e['id']}")
        cs = call("GET", "/personal-conflicts?includeResolved=false", tok)
        print(f"unresolved conflicts: {cs['total']}")
        for c in cs["items"]:
            print(f"  {c['resourceKind']} {c['reason']} base={c['baseRevision']} current={c['currentRevision']} id={c['id']}")
    elif cmd in ("finish", "unfinish"):
        title = sys.argv[2]
        for t, e in editions(tok):
            if t == title:
                w = {"operationId": str(uuid.uuid4()), "baseRevision": e["completion"]["revision"], "fileId": e["file"]["id"],
                     "contentVersion": e["file"]["contentVersion"], "event": "manual_" + cmd,
                     "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")}
                r = call("PUT", f"/editions/{e['id']}/completion", tok, w)
                print(f"{title}: now revision {r['revision']} finished={r['finished']}")
                return
        raise SystemExit("no such title")
    elif cmd == "comic-page":
        # Save a comic position the way the web reader does: page identity copied from the server's page manifest.
        title, index = sys.argv[2], int(sys.argv[3])
        for t, e in editions(tok):
            if t == title:
                f = e["file"]
                m = call("GET", f"/files/{f['id']}/versions/{f['contentVersion']}/pages", tok)
                pos = call("GET", f"/editions/{e['id']}/position", tok)
                page = m["pages"][index]
                w = {"operationId": str(uuid.uuid4()), "baseRevision": pos["revision"],
                     "anchor": {"fileId": f["id"], "contentVersion": f["contentVersion"],
                                "locator": {"kind": "comic-page", "version": 1, "pageIndex": index, "entryId": page["entryId"], "manifestVersion": m["manifestVersion"]}},
                     "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")}
                r = call("PUT", f"/editions/{e['id']}/position", tok, w)
                print(f"{title}: position revision {r['revision']} pageIndex {index} entry {page['entryId'][:12]}...")
                return
        raise SystemExit("no such title")
    else:
        raise SystemExit(__doc__)


main()
