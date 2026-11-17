"""Static T005 assignment checks. Does not build or run the application."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.tmp/t003-validation'))
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate_spec

DIRECTORY = ROOT / 'contracts/t005'
def read(name):
    return json.loads((DIRECTORY / name).read_text(encoding='utf-8'))

spec = read('openapi.json')
validate_spec(spec)
validators = {}
for name, schema in spec['components']['schemas'].items():
    Draft202012Validator.check_schema(schema)
    validators[name] = Draft202012Validator(
        {'$ref': '#/components/schemas/' + name, 'components': spec['components']},
        format_checker=FormatChecker())

examples = read('examples.json')
assert any(e['valid'] for e in examples) and any(not e['valid'] for e in examples)
assert len({e['name'] for e in examples}) == len(examples)
for example in examples:
    errors = list(validators[example['schema']].iter_errors(example['value']))
    assert bool(errors) != example['valid'], f"{example['name']}: unexpected validation: {errors[:1]}"

operations = {}
schemas = set()
for task in ('t003', 't004', 't005'):
    document = json.loads((ROOT / 'contracts' / task / 'openapi.json').read_text(encoding='utf-8'))
    for name in document['components']['schemas']:
        assert name not in schemas, f'duplicate schema: {name}'
        schemas.add(name)
    for path, item in document['paths'].items():
        for method, op in item.items():
            if method not in ('get', 'head', 'post', 'put', 'patch', 'delete', 'options'):
                continue
            assert (method, path) not in operations, f'duplicate route: {method} {path}'
            assert op['operationId'] not in operations.values(), f"duplicate operation ID: {op['operationId']}"
            operations[method, path] = op['operationId']

schemes = spec['components']['securitySchemes']
t3 = json.loads((ROOT / 'contracts/t003/openapi.json').read_text(encoding='utf-8'))
assert schemes == t3['components']['securitySchemes'], 'T005 must keep existing wire auth names'
for path, item in spec['paths'].items():
    for method, op in item.items():
        declared = {p['name'] for p in op['parameters'] if p['in'] == 'path'}
        assert declared == set(re.findall(r'\{([^}]+)\}', path)), path
        assert op['security'], path
        if method not in ('get', 'head'):
            assert {'browserSession': [], 'csrf': []} in op['security'], f'CSRF missing: {path}'
        if path.startswith('/admin/'):
            assert op.get('x-litara-authorization') == 'administrator AND owning-library grant', path

scenarios = read('scenarios.json')['scenarios']
assert len({s['id'] for s in scenarios}) == len(scenarios)
for scenario in scenarios:
    assert scenario['setup'] and scenario['expect'] and scenario['verification']
    for adr in scenario['adrs']:
        assert len(list((ROOT / 'ADR').glob(adr + '-*.md'))) == 1, adr
    for operation_id in scenario.get('operations', []):
        assert operation_id in operations.values(), operation_id

print(f"T005 CONTRACT OK: {len(spec['paths'])} paths, "
      f"{sum(len(i) for i in spec['paths'].values())} operations, "
      f"{len(validators)} schemas, {len(examples)} examples, {len(scenarios)} scenarios")
print('Static preparation only; no implemented route, browser, runtime or hardware verification is claimed.')
