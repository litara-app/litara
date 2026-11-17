"""Validate T006 preparation only; does not exercise runtime/protocol clients/SMTP."""
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.tmp/t003-validation'))
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate_spec

DIR = ROOT / 'contracts/t006'
def read(name):
    return json.loads((DIR / name).read_text(encoding='utf-8'))

documents = {n: read(n) for n in ('openapi.json', 'protocols.openapi.json')}
validators = {}
for filename, document in documents.items():
    validate_spec(document)
    for name, schema in document['components']['schemas'].items():
        Draft202012Validator.check_schema(schema)
        validators[filename, name] = Draft202012Validator(
            {'$ref': '#/components/schemas/' + name, 'components': document['components']},
            format_checker=FormatChecker())

examples = read('examples.json')
assert len({x['name'] for x in examples}) == len(examples)
assert any(e['valid'] for e in examples) and any(not e['valid'] for e in examples)
for example in examples:
    errors = list(validators[example['document'], example['schema']].iter_errors(example['value']))
    assert bool(errors) != example['valid'], f"{example['name']}: unexpected validation {errors[:1]}"

routes, operation_ids, schema_names = {}, set(), set()
for task in ('t003', 't004', 't005', 't006'):
    files = ['openapi.json'] + (['protocols.openapi.json'] if task == 't006' else [])
    for filename in files:
        document = json.loads((ROOT / 'contracts' / task / filename).read_text(encoding='utf-8'))
        base = document['servers'][0]['url'].rstrip('/')
        for name in document['components']['schemas']:
            assert name not in schema_names, f'duplicate schema name {name}'
            schema_names.add(name)
        for path, item in document['paths'].items():
            for method, operation in item.items():
                if method not in ('get', 'head', 'post', 'put', 'delete', 'patch', 'options'):
                    continue
                identity = method, re.sub(r'\{[^}]+\}', '{}', base + path)
                assert identity not in routes, f'duplicate normalized route {identity}'
                routes[identity] = operation['operationId']
                assert operation['operationId'] not in operation_ids, operation['operationId']
                operation_ids.add(operation['operationId'])
                if task == 't006':
                    declared = {p['name'] for p in operation.get('parameters', []) if p['in'] == 'path'}
                    assert declared == set(re.findall(r'\{([^}]+)\}', path)), path
                    assert operation.get('x-litara-authorization'), path
                    assert operation['responses'], path
                    if filename == 'openapi.json':
                        assert operation['security'], path
                        if method not in ('get', 'head'):
                            assert {'browserSession': [], 'csrf': []} in operation['security'], path
                        if path.startswith('/admin/'):
                            assert operation['x-litara-authorization'].startswith('administrator'), path
                    elif path.startswith('/opds/'):
                        assert operation['security'] == [{'opdsBasic': []}], path
                        assert 'WWW-Authenticate' in operation['responses']['401']['headers'], path
                    elif path not in ('/1/healthcheck', '/1/users/create'):
                        assert operation['security'] == [{'koUser': [], 'koKey': []}], path

expected_auth = json.loads((ROOT / 'contracts/t003/openapi.json').read_text(encoding='utf-8'))['components']['securitySchemes']
assert documents['openapi.json']['components']['securitySchemes'] == expected_auth

def check_refs(node, document):
    if isinstance(node, dict):
        if '$ref' in node:
            assert node['$ref'].startswith('#/components/schemas/')
            assert node['$ref'].rsplit('/', 1)[1] in document['components']['schemas']
        for value in node.values():
            check_refs(value, document)
    elif isinstance(node, list):
        for item in node:
            check_refs(item, document)
for document in documents.values():
    check_refs(document, document)

all_t6 = {o['operationId'] for d in documents.values() for item in d['paths'].values() for o in item.values()}
scenarios = read('scenarios.json')['scenarios']
assert len({s['id'] for s in scenarios}) == len(scenarios)
covered = set()
for scenario in scenarios:
    assert scenario['setup'] and scenario['expect'] and scenario['verification']
    assert scenario['operations']
    for operation in scenario['operations']:
        assert operation in all_t6, operation
        covered.add(operation)
    for adr in scenario['adrs']:
        matches = list((ROOT / 'ADR').glob(adr + '-*.md'))
        assert len(matches) == 1, adr
        assert '\nStatus: Accepted\n' in matches[0].read_text(encoding='utf-8'), adr
assert covered == all_t6, f'operations without scenarios: {sorted(all_t6 - covered)}'

vectors = read('digest-vectors.json')['vectors']
for vector in vectors:
    data = bytes(i % 251 for i in range(vector['size']))
    h = hashlib.md5(data[:1024])
    for i in range(11):
        chunk = data[(4 ** i) * 1024:(4 ** i) * 1024 + 1024]
        if not chunk:
            break
        h.update(chunk)
    assert h.hexdigest() == vector['expectedPartialMd5']
    assert hashlib.sha256(data).hexdigest() == vector['sha256']

# Local smoke validation of synthetic fixtures, explicitly not full OPDS conformance.
feed = read('fixtures/opds-v2-acquisition.json')
validators['protocols.openapi.json', 'T006OpdsFeed'].validate(feed)
validators['protocols.openapi.json', 'T006OpdsPublication'].validate(read('fixtures/opds-v2-publication.json'))
xml = (DIR / 'fixtures/opds-v1-acquisition.xml').read_text(encoding='utf-8')
assert '<!DOCTYPE' not in xml and '<!ENTITY' not in xml
atom = ET.fromstring(xml)
ns = {'a': 'http://www.w3.org/2005/Atom'}
assert atom.find('a:id', ns) is not None and atom.find('a:updated', ns) is not None
entry = atom.find('a:entry', ns)
assert entry.find('a:title', ns).text == 'A & B <Fixture>'
acquisition = entry.find("a:link[@rel='http://opds-spec.org/acquisition']", ns)
assert acquisition is not None
assert acquisition.attrib['href'] == feed['publications'][0]['links'][1]['href']
for link in [acquisition.attrib] + feed['links'] + feed['publications'][0]['links']:
    url = urlsplit(link['href'])
    assert url.hostname == 'litara.example.invalid'
    assert not url.username and not url.password and not url.query
smtp = read('fixtures/smtp-outcomes.json')
assert smtp['syntheticRecipientsOnly'] is True
assert any(c['expect'] == 'outcome_unknown' for c in smtp['cases'])
for case in smtp['cases']:
    if case['submitted'] and not case['acknowledged']:
        assert case['expect'] == 'outcome_unknown'
trace = read('fixtures/koreader-device-sequence.json')['steps']
assert trace[3]['canonicalRevision'] == trace[2]['canonicalRevision']
assert trace[5]['candidate'] == trace[3]['candidate'] == trace[8]['candidate']
assert trace[8]['canonicalRevision'] == trace[6]['canonicalRevision']
print(f'T006 PREPARATION OK: {len(all_t6)} operations ({sum(len(x) for x in documents["openapi.json"]["paths"].values())} management / {sum(len(x) for x in documents["protocols.openapi.json"]["paths"].values())} protocol), {len(validators)} schemas, {len(examples)} examples, {len(scenarios)} scenarios, {len(vectors)} digest vectors')
print('Static preparation only; no OPDS conformance, SMTP send, client/browser/runtime/hardware success is claimed.')
