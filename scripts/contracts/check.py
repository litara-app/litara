"""Validate T003 specification/fixtures; does not test the application runtime."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Optional isolated install documented by contracts/t003/README.md.
sys.path.insert(0, str(ROOT / '.tmp' / 't003-validation'))
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012
from openapi_spec_validator import validate_spec

CONTRACT = ROOT / 'contracts' / 't003'
def read(name):
    return json.loads((CONTRACT / name).read_text(encoding='utf-8'))

spec = read('openapi.json')
validate_spec(spec)
registry = Registry().with_resource('urn:litara:t003', Resource.from_contents(spec, default_specification=DRAFT202012))
validators = {}
for name, schema in spec['components']['schemas'].items():
    Draft202012Validator.check_schema(schema)
    validators[name] = Draft202012Validator({'$ref': 'urn:litara:t003#/components/schemas/' + name}, registry=registry, format_checker=FormatChecker())

examples = read('fixtures/examples.json')
for example in examples:
    errors = list(validators[example['schema']].iter_errors(example['value']))
    if bool(errors) == example['valid']:
        raise AssertionError(f"{example.get('name', example['schema'])}: expected valid={example['valid']}; {errors[:1]}")

versions = read('fixtures/recording-versions.json')
def check_recording(recording):
    validators['Recording'].validate(recording)
    files = recording['files']
    assert [f['sequence'] for f in files] == list(range(len(files)))
    assert len({f['id'] for f in files}) == len(files)
    by_id = {f['id']: f for f in files}
    starts = {}
    cursor = 0
    for f in files:
        starts[f['id']] = cursor
        cursor = cursor + f['durationMs'] if cursor is not None and f['durationMs'] is not None else None
        assert f['contentPath'].endswith(f"/files/{f['id']}/versions/{f['contentVersion']}/content")
    assert recording['durationMs'] == cursor
    ready = recording['readiness'] == 'ready'
    assert all(recording['capabilities'][k] == ready for k in ('play', 'download', 'wholeRecordingSeek'))
    if ready:
        assert all(f['available'] and f['durationMs'] and f['sizeBytes'] is not None for f in files)
    previous = -1
    for chapter in recording['chapters']:
        anchor = chapter['start']
        f = by_id[anchor['fileId']]
        assert f['contentVersion'] == anchor['contentVersion']
        assert anchor['offsetMs'] >= 0
        if f['durationMs'] is not None:
            assert anchor['offsetMs'] < f['durationMs']
        start = starts[f['id']]
        expected = start + anchor['offsetMs'] if start is not None else None
        assert chapter['recordingStartMs'] == expected
        assert chapter['generated'] == (chapter['source'] == 'generated')
        if expected is not None:
            assert expected > previous
            previous = expected

for example in examples:
    if example['valid'] and example['schema'] == 'Recording':
        check_recording(example['value'])
for key in ('original', 'reordered', 'replaced', 'oldDownload'):
    check_recording(versions[key])
assert versions['oldDownload'] == versions['original']
assert versions['original']['layoutRevision'] != versions['reordered']['layoutRevision']
assert [c['recordingStartMs'] for c in versions['reordered']['chapters']] == versions['expected']['reorderedChapterStarts']
assert versions['original']['files'][1]['id'] == versions['replaced']['files'][1]['id']
assert versions['original']['files'][1]['contentVersion'] != versions['replaced']['files'][1]['contentVersion']

# Independently evaluate byte arithmetic, not an HTTP server implementation.
def range_result(case):
    text, size = case['range'], case['size']
    if text is None or (case.get('ifRange') and case['ifRange'] != case['currentEtag']):
        return {'status': 200, 'length': size}
    if ',' in text:
        return {'status': 200, 'length': size}
    if not text.startswith('bytes=') or '-' not in text:
        return {'status': 400}
    first, last = text[6:].split('-', 1)
    if not first:
        length = int(last)
        if length == 0 or size == 0:
            return {'status': 416, 'contentRange': f'bytes */{size}'}
        start, end = max(size - length, 0), size - 1
    else:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
        if start >= size or end < start:
            return {'status': 416, 'contentRange': f'bytes */{size}'}
    return {'status': 206, 'start': start, 'end': end, 'length': end-start+1}

ranges = read('fixtures/ranges.json')
for case in ranges:
    result = range_result(case)
    for key, value in result.items():
        assert case[key] == value, (case, result)

operations = [op for item in spec['paths'].values() for op in item.values()]
assert len({op['operationId'] for op in operations}) == len(operations)
assert all(op['responses'] for op in operations)
for path, item in spec['paths'].items():
    for method, op in item.items():
        if method == 'head':
            assert all('content' not in response for response in op['responses'].values())
scenarios = read('fixtures/scenarios.json')
assert len({s['id'] for s in scenarios}) == len(scenarios)
assert {'l6-account-switch', 'refresh-lost-response', 'refresh-reuse', 'stale-position', 'layout-change', 'replacement', 'web-csrf', 'completion-stale'} <= {s['id'] for s in scenarios}
chapters = read('fixtures/chapter-sources.json')
assert len(chapters['cases']) == 7
assert all(case['expected'] in ('user', 'cue', 'embedded', 'generated') for case in chapters['cases'])
authorization = read('fixtures/authorization.json')
assert len(authorization) == 9
assert next(c for c in authorization if c['actor'] == 'admin-no-grants' and c['method'] == 'GET')['expected'] == 403
auth = read('fixtures/auth-exchanges.json')
assert (auth['accessSeconds'], auth['idleSeconds'], auth['absoluteSeconds'], auth['refreshRecoverySeconds']) == (900, 2592000, 7776000, 60)
print(f"CONTRACT OK: {len(operations)} operations, {len(validators)} schemas, {len(examples)} positive/negative examples, {len(ranges)} ranges, {len(scenarios)} runtime scenarios inventoried")
print('Specification/static checks only; no server/Android/hardware behavior executed.')
