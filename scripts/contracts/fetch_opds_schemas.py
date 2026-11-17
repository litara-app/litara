"""Fetch the pinned official OPDS 2.0 schemas for the T006 conformance test.

Usage: python scripts/contracts/fetch_opds_schemas.py [target-dir]

The five files are downloaded from the exact upstream commit named in
contracts/t006/vendor/opds/MANIFEST.json and verified against the recorded
SHA-256 before use. The default target is .tmp/t006-opds-schemas (not
committed): the upstream repository (opds-community/specs) declares no license,
so the files are not redistributed here. This is a developer/CI-time step; the
server never fetches schemas at runtime. The Readium schemas they reference are
BSD-3-Clause and are vendored under contracts/t006/vendor/readium.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
manifest = json.loads((ROOT / 'contracts' / 't006' / 'vendor' / 'opds' / 'MANIFEST.json').read_text(encoding='utf-8'))
target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.tmp' / 't006-opds-schemas'
target.mkdir(parents=True, exist_ok=True)
for entry in manifest['files']:
    with urllib.request.urlopen(urllib.request.Request(entry['url'], headers={'User-Agent': 'litara-schema-fetch'}), timeout=60) as r:
        data = r.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != entry['sha256']:
        raise SystemExit(f"{entry['file']}: checksum mismatch ({digest} != {entry['sha256']})")
    (target / Path(entry['file']).name).write_bytes(data)
    print('ok', entry['file'])
print('schemas verified in', target)
