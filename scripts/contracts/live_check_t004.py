"""Third-party-client check of the T004 library management flow against a running,
seeded Litara server (stdlib HTTP only, no Litara code).

Usage: LITARA_LIVE_PASSWORD=... python scripts/contracts/live_check_t004.py http://127.0.0.1:8080

Expects the T003 seed (fixture-admin) and two mounts inside the container:
/media (read-only, contains media files) and /library (writable, empty).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip('/') + '/api/v1'
PASSWORD = os.environ['LITARA_LIVE_PASSWORD']


def call(method, path, token=None, body=None, expect=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        resp = urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        resp = e
    raw = resp.read()
    status = resp.status if hasattr(resp, 'status') else resp.code
    parsed = json.loads(raw) if raw and 'json' in (resp.headers.get('Content-Type') or '') else None
    if expect is not None and status != expect:
        raise SystemExit(f'FAIL {method} {path}: {status} (want {expect}): {raw[:300]!r}')
    return status, parsed


def poll(fn, what, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(1)
    raise SystemExit(f'FAIL timed out waiting for {what}')


_, tok = call('POST', '/auth/native/login', body={'username': 'fixture-admin', 'password': PASSWORD, 'deviceName': 'live-check-t004'}, expect=200)
token = tok['accessToken']
_, users = call('GET', '/admin/users?size=100', token, expect=200)
admin_id = next(u['id'] for u in users['items'] if u['username'] == 'fixture-admin')

# Anonymous and non-admin callers are refused.
call('GET', '/admin/writers', None, expect=401)


def make_library(name, mode, root):
    _, d = call('POST', '/admin/libraries', token, {'name': name, 'config': {
        'mode': mode, 'rootPath': root, 'followSymlinks': False, 'writebackBackups': False,
        'stabilitySecs': 1, 'providerOrder': []}}, expect=201)
    lib = d['library']['id']
    # Creating a library grants nobody, not even the creator.
    call('GET', f'/admin/libraries/{lib}', token, expect=403)
    call('PUT', f'/admin/users/{admin_id}/libraries/{lib}', token, expect=204)
    call('GET', f'/admin/libraries/{lib}', token, expect=200)
    return lib


def scan(lib, verify=False):
    _, run = call('POST', f'/admin/libraries/{lib}/scans', token, {'verify': verify}, expect=202)

    def done():
        _, runs = call('GET', f'/admin/libraries/{lib}/scans', token, expect=200)
        r = next(x for x in runs['items'] if x['id'] == run['id'])
        return r if r['state'] in ('completed', 'failed') else None
    r = poll(done, 'scan to finish')
    if r['state'] != 'completed':
        raise SystemExit(f'FAIL scan failed: {r}')
    return r


# ---- index library on the READ-ONLY mount ---------------------------------
idx = make_library('Live index', 'index', '/media')
first = scan(idx)
if first['health'] != 'healthy' or first['filesSeen'] < 4:
    raise SystemExit(f'FAIL first scan: {first}')
time.sleep(2)  # stability window (1s) elapses
scan(idx)
_, recs = call('GET', f'/recordings?libraryId={idx}&size=50', token, expect=200)
if not recs['items']:
    raise SystemExit('FAIL no recordings were created from the read-only mount')
rec = recs['items'][0]['id']
# The generated fixtures carry no tags, so the report may start empty; a protected edit must appear with provenance.
call('GET', f'/admin/recordings/{rec}/metadata', token, expect=200)
call('PUT', f'/admin/recordings/{rec}/metadata/title', token, {'value': 'Live Edited Title'}, expect=204)
call('PUT', f'/admin/recordings/{rec}/metadata/series_name', token, {'clear': True}, expect=204)
_, meta = call('GET', f'/admin/recordings/{rec}/metadata', token, expect=200)
fields = {f['field']: f for f in meta['fields']}
if fields.get('title', {}).get('source') != 'user' or not fields.get('series_name', {}).get('cleared'):
    raise SystemExit(f'FAIL protected edit/clear provenance: {meta}')

# A sidecar export onto a read-only mount is refused cleanly; nothing is written.
_, plan = call('POST', f'/admin/recordings/{rec}/writebacks/sidecar', token, expect=201)
call('POST', f'/admin/writebacks/{plan["id"]}/approve', token, expect=204)
status, body = call('POST', f'/admin/writebacks/{plan["id"]}/execute', token)
if status != 409 or body.get('code') != 'write_refused':
    raise SystemExit(f'FAIL write onto a read-only mount should be refused: {status} {body}')
_, writers = call('GET', '/admin/writers', token, expect=200)
if any(w['enabled'] for w in writers['items']):
    raise SystemExit('FAIL no in-file writer may be enabled by default')

# ---- managed library on the WRITABLE mount ----------------------------------
mgd = make_library('Live managed', 'managed', '/library')
_, plan = call('POST', f'/admin/libraries/{mgd}/imports', token, {'sourcePath': '/media'}, expect=201)
if not plan['items']:
    raise SystemExit('FAIL import plan has no items')
call('POST', f'/admin/libraries/{mgd}/imports/{plan["id"]}/approve', token, expect=204)
call('POST', f'/admin/libraries/{mgd}/imports/{plan["id"]}/execute', token, expect=202)


def import_done():
    _, p = call('GET', f'/admin/libraries/{mgd}/imports/{plan["id"]}', token, expect=200)
    return p if p['state'] in ('completed', 'failed') else None


done = poll(import_done, 'import to finish')
published = [i for i in done['items'] if i['state'] == 'published']
if done['state'] != 'completed' or not published:
    raise SystemExit(f'FAIL import: {json.dumps(done)[:500]}')
scan(mgd)
time.sleep(2)
scan(mgd)
_, recs = call('GET', f'/recordings?libraryId={mgd}&size=50', token, expect=200)
if not recs['items']:
    raise SystemExit('FAIL imported files were not cataloged')

# Source retained: the read-only library still lists its files.
scan(idx)
print('T004 LIVE OK:', len(published), 'files imported;', len(recs['items']), 'recordings in the managed library')
