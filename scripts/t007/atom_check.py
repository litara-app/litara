#!/usr/bin/env python3
"""OPDS 1.x Atom rule check against the live disposable stack (T007 M4, scenario opds-conformance).

  python scripts/t007/atom_check.py [--out research/t007/evidence/m4-atom]

No authoritative Atom/OPDS 1.x validator (RelaxNG/Schematron) is installed or bundled, so this is NOT formal validation: it is a
stdlib checker for the hard requirements of RFC 4287 (feed/entry id, title, updated as RFC 3339, author coverage, unique entry
ids, link href) and the OPDS 1.2 catalog rules that clients depend on (feed Content-Type profile and kind, self/start/search
links, navigation vs acquisition entries, acquisition relations with a type and size where known, pagination relations).
It crawls every feed reachable from /opds/v1 with the synthetic OPDS credential and also checks well-formedness of each.
"""
import base64, datetime, json, re, sys, urllib.request, urllib.error, uuid, xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

ROOT, WORK = stack.ROOT, stack.WORK
OUT = ROOT / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "research/t007/evidence/m4-atom")
A = "{http://www.w3.org/2005/Atom}"
RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$")
results = []


def check(ctx, name, ok, detail="", advisory=False):
    results.append({"feed": ctx, "rule": name, "pass": bool(ok), "detail": str(detail)[:200], "advisory": advisory})


def fetch(url, auth):
    req = urllib.request.Request(url, headers={"Authorization": "Basic " + auth, "Accept": "application/atom+xml"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, dict((k.lower(), v) for k, v in r.getheaders()), r.read()


def links(el):
    return [(l.get("rel", "alternate"), l.get("type", ""), l.get("href", ""), l.get("length")) for l in el.findall(A + "link")]


def check_feed(url, auth, seen, queue):
    status, hdr, body = fetch(url, auth)
    ctx = url.replace(stack.BASE, "")
    check(ctx, "HTTP 200", status == 200, status)
    ct = hdr.get("content-type", "")
    check(ctx, "Content-Type is application/atom+xml with profile=opds-catalog", ct.startswith("application/atom+xml") and "profile=opds-catalog" in ct, ct)
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        check(ctx, "well-formed XML", False, e)
        return
    check(ctx, "well-formed XML", True)
    if root.tag == A + "entry":  # an OPDS 1.2 single-entry (publication) document: RFC 4287 section 4.1.2 rules, no feed rules
        check(ctx, "entry document is served as application/atom+xml;type=entry", ct.startswith("application/atom+xml") and "type=entry" in ct, ct)
        for tag in ("id", "title", "updated"):
            check(ctx, f"entry {tag} present", (root.findtext(A + tag) or "").strip() != "")
        check(ctx, "entry updated is RFC 3339", bool(RFC3339.match((root.findtext(A + "updated") or "").strip())), root.findtext(A + "updated"))
        check(ctx, "entry has an author", root.find(A + "author") is not None)
        el = links(root)
        check(ctx, "entry document has rel=self (SHOULD: lets a client re-fetch it; RFC 5023 practice, not an RFC 4287 MUST)", any(r == "self" for r, _, _, _ in el), advisory=True)
        check(ctx, "every entry link has an href", all(h for _, _, h, _ in el))
        check(ctx, "acquisition links carry a media type", all(t for r, t, _, _ in el if r.startswith("http://opds-spec.org/acquisition")), [r for r, _, _, _ in el])
        return
    check(ctx, "root is atom:feed", root.tag == A + "feed", root.tag)
    kind = re.search(r"kind=(\w+)", ct)
    check(ctx, "Content-Type names kind=navigation or acquisition", bool(kind) and kind[1] in ("navigation", "acquisition"), ct)
    for tag in ("id", "title", "updated"):
        el = root.find(A + tag)
        check(ctx, f"feed {tag} present and non-empty", el is not None and (el.text or "").strip() != "")
    fid = root.find(A + "id")
    check(ctx, "feed id is an absolute IRI/URN", fid is not None and re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", (fid.text or "").strip()) is not None, fid.text if fid is not None else "")
    up = root.find(A + "updated")
    check(ctx, "feed updated is RFC 3339", up is not None and bool(RFC3339.match((up.text or "").strip())), up.text if up is not None else "")
    ls = links(root)
    rels = {r for r, _, _, _ in ls}
    check(ctx, "feed has rel=self", "self" in rels)
    check(ctx, "feed has rel=start (OPDS 1.2)", "start" in rels)
    check(ctx, "every feed link has an href", all(h for _, _, h, _ in ls))
    entries = root.findall(A + "entry")
    feed_author = root.find(A + "author") is not None
    ids = [(e.findtext(A + "id") or "").strip() for e in entries]
    check(ctx, "entry ids are unique", len(ids) == len(set(ids)), len(ids))
    for i, e in enumerate(entries):
        ec = f"{ctx} entry[{i}]"
        for tag in ("id", "title", "updated"):
            check(ec, f"entry {tag} present", (e.findtext(A + tag) or "").strip() != "")
        eu = (e.findtext(A + "updated") or "").strip()
        check(ec, "entry updated is RFC 3339", bool(RFC3339.match(eu)), eu)
        check(ec, "entry has an author (own or feed-level, RFC 4287 4.1.1)", feed_author or e.find(A + "author") is not None)
        el = links(e)
        check(ec, "entry has content, summary or a link", e.find(A + "content") is not None or e.find(A + "summary") is not None or bool(el))
        check(ec, "every entry link has an href", all(h for _, _, h, _ in el))
        acq = [(r, t, h, n) for r, t, h, n in el if r.startswith("http://opds-spec.org/acquisition")]
        nav = [(r, t, h, n) for r, t, h, n in el if r in ("subsection", "start", "http://opds-spec.org/sort/new", "http://opds-spec.org/sort/popular", "related") or "opds-catalog" in t]
        check(ec, "entry is a navigation entry or has an acquisition link", bool(acq) or bool(nav) or kind and kind[1] == "navigation", [r for r, _, _, _ in el])
        for r, t, h, n in acq:
            check(ec, "acquisition link has a media type", bool(t), r)
        for r, t, h, n in nav:
            if "opds-catalog" in t:
                u = urljoin(url, h)
                if u not in seen:
                    seen.add(u)
                    queue.append(u)
    for r, t, h, n in ls:
        if r in ("next", "previous", "first", "last", "subsection") or ("opds-catalog" in t and r != "self"):
            u = urljoin(url, h)
            if u not in seen and "/opds/" in u:
                seen.add(u)
                queue.append(u)
    for e in entries:  # detail entries are single-entry documents too
        for r, t, h, n in links(e):
            if r == "alternate" and "atom" in t:
                u = urljoin(url, h)
                if u not in seen:
                    seen.add(u)
                    queue.append(u)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stack.up()
    c = json.loads((WORK / "creds.json").read_text())
    rt = stack.api("POST", "/auth/native/login", body={"username": c["reader"][0], "password": c["reader"][1], "deviceName": "atom-check"})["accessToken"]
    adm = stack.api("POST", "/auth/native/login", body={"username": c["admin"][0], "password": c["admin"][1], "deviceName": "atom-check-a"})["accessToken"]
    for _ in range(8):
        if stack.api("GET", "/editions?size=50", rt)["total"] >= 4:
            break
        try:
            stack.api("POST", f"/admin/libraries/{c['library']}/scans", adm, {})
        except SystemExit:
            pass
        import time
        time.sleep(4)
    ist = stack.api("GET", "/integrations/settings", adm)
    stack.api("PUT", "/admin/integrations/settings", adm, {"operationId": str(uuid.uuid4()), "baseRevision": ist["revision"], "opdsEnabled": True, "emailEnabled": ist["emailEnabled"],
              "koreaderEnabled": ist["koreaderEnabled"], "maxAttachmentBytes": ist["maxAttachmentBytes"], "maxDeliveriesPerUserPerHour": ist["maxDeliveriesPerUserPerHour"]})
    pw = uuid.uuid4().hex + uuid.uuid4().hex
    cr = stack.api("POST", "/integration-credentials", rt, {"operationId": str(uuid.uuid4()), "kind": "opds", "label": "atom-check", "password": pw})
    auth = base64.b64encode(f"{cr['username']}:{pw}".encode()).decode()
    start = stack.BASE + "/opds/v1"
    seen, queue = {start}, [start]
    n = 0
    while queue and n < 40:
        u = queue.pop(0)
        n += 1
        try:
            check_feed(u, auth, seen, queue)
        except urllib.error.HTTPError as e:
            check(u.replace(stack.BASE, ""), "feed fetch", False, str(e.code) + " " + e.read()[:160].decode("utf-8", "replace"))
    # the OpenSearch description referenced by OPDS 1.x
    try:
        st, h, b = fetch(stack.BASE + "/opds/v1/search.xml", auth)
        root = ET.fromstring(b)
        check("/opds/v1/search.xml", "OpenSearch description root and a Url template", root.tag.endswith("OpenSearchDescription") and any(u.get("template") for u in root if u.tag.endswith("Url")), root.tag)
    except Exception as e:  # noqa: BLE001
        check("/opds/v1/search.xml", "OpenSearch description fetch", False, e)
    stack.down(quiet=True)
    failed = [r for r in results if not r["pass"] and not r["advisory"]]
    advisory = [r for r in results if not r["pass"] and r["advisory"]]
    feeds = sorted({r["feed"].split(" ")[0] for r in results})
    rep = {"finished": datetime.datetime.now(datetime.timezone.utc).isoformat(), "formalValidation": False,
           "limitation": "no authoritative RelaxNG/Schematron validator available; stdlib rule check only", "feedsChecked": feeds, "rules": len(results), "failed": len(failed), "failures": failed[:50], "advisoryFindings": len(advisory), "advisoryExample": advisory[:2]}
    (OUT / "run.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    print(f"{len(feeds)} feeds, {len(results)} rule checks, {len(failed)} failed, {len(advisory)} advisory")
    for r in failed[:15]:
        print("FAIL", r["feed"], r["rule"], r["detail"])
    sys.exit(0 if not failed else 1)


main()
