"""Third-party-client check of a running, seeded Litara server (stdlib HTTP only).

Usage: LITARA_LIVE_PASSWORD=... python scripts/contracts/live_check.py http://127.0.0.1:8080

It uses no Litara code: plain HTTP, the public bearer login, and the shared
OpenAPI document to validate response bodies. It needs the seed from
`ctl seed` and the synthetic account password given to that seed.
"""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.tmp' / 't003-validation'))
from jsonschema import Draft202012Validator, FormatChecker  # noqa: E402
from referencing import Registry, Resource  # noqa: E402
from referencing.jsonschema import DRAFT202012  # noqa: E402

AFTER_RESTART = '--after-restart' in sys.argv
BASE = [a for a in sys.argv[1:] if not a.startswith('--')][0].rstrip('/') + '/api/v1'
PASSWORD = os.environ['LITARA_LIVE_PASSWORD']
SPEC = json.loads((ROOT / 'contracts' / 't003' / 'openapi.json').read_text(encoding='utf-8'))
REG = Registry().with_resource('urn:litara:t003', Resource.from_contents(SPEC, default_specification=DRAFT202012))


def validate(schema, value):
    Draft202012Validator({'$ref': 'urn:litara:t003#/components/schemas/' + schema}, registry=REG,
                         format_checker=FormatChecker()).validate(value)


def call(method, path, token=None, body=None, headers=None, expect=None, schema=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        resp = urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        resp = e
    raw = resp.read()
    status = resp.status if hasattr(resp, 'status') else resp.code
    if expect is not None and status != expect:
        raise SystemExit(f'FAIL {method} {path}: {status} (want {expect}): {raw[:300]!r}')
    parsed = None
    if raw and 'json' in (resp.headers.get('Content-Type') or ''):
        parsed = json.loads(raw)
        if schema:
            validate(schema, parsed)
        if status >= 400:
            validate('Problem', parsed)
    return status, resp.headers, raw, parsed


def login(user):
    _, _, _, tp = call('POST', '/auth/native/login',
                       body={'username': user, 'password': PASSWORD, 'deviceName': 'live-check'}, expect=200, schema='TokenPair')
    return tp


if AFTER_RESTART:
    a = login('fixture-user-a')
    fin = call('GET', '/recordings?completion=finished', a['accessToken'], expect=200, schema='Recordings')[3]
    assert fin['total'] == 1, fin
    pos = call('GET', '/recordings/' + fin['items'][0]['id'] + '/position', a['accessToken'], expect=200, schema='PositionState')[3]
    assert pos['revision'] == '1' and len(pos['unresolvedConflicts']) == 1, pos
    print('state survived the restart: finished recording, revision 1, durable conflict')
    sys.exit(0)

disc = call('GET', '/discovery', expect=200, schema='Discovery')[3]
print('server', disc['serverId'])
a, b, admin = login('fixture-user-a'), login('fixture-user-b'), login('fixture-admin')
call('GET', '/recordings', expect=401)

_, _, _, listing = call('GET', '/recordings?size=50', a['accessToken'], expect=200, schema='Recordings')
assert listing['total'] == 3, listing['total']
three = next(r for r in listing['items'] if r['durationMs'] == 180000)
_, _, _, snap = call('GET', '/recordings/' + three['id'], a['accessToken'], expect=200, schema='Recording')
assert snap['readiness'] == 'ready' and len(snap['files']) == 3

# Authorization boundaries.
call('GET', '/recordings/' + three['id'], b['accessToken'], expect=403)
call('GET', '/recordings/' + three['id'], admin['accessToken'], expect=403)
call('POST', '/admin/users', a['accessToken'], {'username': 'x', 'displayName': 'x', 'password': 'long-enough-password', 'isAdmin': False}, expect=403)
call('POST', '/admin/users', admin['accessToken'], {'username': 'live-' + uuid.uuid4().hex[:8], 'displayName': 'Live', 'password': 'long-enough-password', 'isAdmin': False}, expect=201, schema='User')

# Original bytes: full download hash equals the sum of ranged downloads, with exact 206 semantics.
f = snap['files'][1]
path = f['contentPath'][len('/api/v1'):]
_, h, full, _ = call('GET', path, a['accessToken'], expect=200)
assert len(full) == f['sizeBytes'] and h['Accept-Ranges'] == 'bytes' and h['Content-Type'] == f['mimeType']
part1 = call('GET', path, a['accessToken'], headers={'Range': 'bytes=0-999'}, expect=206)
assert part1[2] == full[:1000] and part1[1]['Content-Range'] == f'bytes 0-999/{len(full)}'
rest = call('GET', path, a['accessToken'], headers={'Range': 'bytes=1000-'}, expect=206)
assert hashlib.sha256(part1[2] + rest[2]).digest() == hashlib.sha256(full).digest()
call('GET', path, a['accessToken'], headers={'Range': f'bytes={len(full)}-'}, expect=416)
call('GET', path, b['accessToken'], expect=403)
assert call('HEAD', path, a['accessToken'], expect=200)[1]['Content-Length'] == str(len(full))

# Revisioned progress and completion.
rid = three['id']
w = {'operationId': str(uuid.uuid4()), 'baseRevision': '0', 'layoutRevision': snap['layoutRevision'],
     'position': {'fileId': f['id'], 'contentVersion': f['contentVersion'], 'offsetMs': 12345, 'capturedAt': '2026-11-13T12:00:00Z'}}
st = call('PUT', f'/recordings/{rid}/position', a['accessToken'], w, expect=200, schema='PositionState')[3]
assert st['revision'] == '1'
assert call('PUT', f'/recordings/{rid}/position', a['accessToken'], w, expect=200)[3] == st  # idempotent retry
stale = dict(w, operationId=str(uuid.uuid4()))
c = call('PUT', f'/recordings/{rid}/position', a['accessToken'], stale, expect=409)[3]
assert c['code'] == 'position_conflict' and c['conflictId']
last = snap['files'][-1]
nat = {'operationId': str(uuid.uuid4()), 'baseRevision': '0', 'layoutRevision': snap['layoutRevision'], 'event': 'natural_end',
       'capturedAt': '2026-11-13T12:00:00Z',
       'finalPosition': {'fileId': last['id'], 'contentVersion': last['contentVersion'], 'offsetMs': last['durationMs']}}
cs = call('PUT', f'/recordings/{rid}/completion', a['accessToken'], nat, expect=200, schema='CompletionState')[3]
assert cs['finished'] and cs['revision'] == '1'
hist = call('GET', f"/titles/{snap['titleId']}/history", a['accessToken'], expect=200, schema='History')[3]
assert hist['total'] == 1

# Lost-response refresh: the identical exchange returns the identical credentials.
rq = str(uuid.uuid4())
first = call('POST', '/auth/native/refresh', body={'refreshToken': a['refreshToken'], 'requestId': rq}, expect=200, schema='TokenPair')[3]
again = call('POST', '/auth/native/refresh', body={'refreshToken': a['refreshToken'], 'requestId': rq}, expect=200)[3]
assert first == again
call('POST', '/auth/native/refresh', body={'refreshToken': a['refreshToken'], 'requestId': str(uuid.uuid4())}, expect=401)
call('GET', '/me', first['accessToken'], expect=401)  # reuse revoked that device session
print('LIVE CHECK OK')
