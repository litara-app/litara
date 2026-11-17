// Semantic comparison of the pinned web engine and the preserved Android engine (MIT script; reads both trees, copies nothing).
// Formatting-only differences (prettier, quotes, parentheses, comments) disappear when both files are reduced to their syntax tree.
//   node scripts/t007/locators/ast-compare.mjs [--out research/t007/evidence/m1-locators]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { parseAst } = createRequire(path.join(root, 'apps/web/package.json'))('rolldown/parseAst');
const WEB = path.join(root, 'apps/web/public/reader/vendor/foliate-js');
const AND = path.join(root, 'apps/android/app/src/main/assets/reader/foliate');
const out = path.resolve(root, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'research/t007/evidence/m1-locators');

// Reduce a file to its syntax tree (ESTree from rolldown's parser) without positions, raw literal text, parentheses or comments.
const DROP = new Set(['start', 'end', 'loc', 'range', 'raw', 'comments', 'leadingComments', 'trailingComments', 'hashbang', 'phase']);
const reduce = n => {
  if (Array.isArray(n)) return n.map(reduce);
  if (n && typeof n === 'object') {
    if (n.type === 'ParenthesizedExpression') return reduce(n.expression);
    return Object.fromEntries(Object.entries(n).filter(([k]) => !DROP.has(k)).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : reduce(v)]));
  }
  return n;
};
const parseFile = f => parseAst(fs.readFileSync(f, 'utf8'), { lang: 'js', sourceType: 'module' });
const hash = o => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? String(v) : v instanceof RegExp ? String(v) : v));
const nameOf = s => s.id?.name ?? s.declaration?.id?.name ?? s.declarations?.[0]?.id?.name ?? s.declaration?.declarations?.[0]?.id?.name ?? null;
const top = prog => prog.body.map(s => ({ type: s.type, name: nameOf(s), h: hash(reduce(s)) }));
const ast = f => reduce(parseFile(f));

const shared = fs.readdirSync(WEB).filter(f => f.endsWith('.js') && fs.existsSync(path.join(AND, f))).sort();
const report = { generated: new Date().toISOString(), files: {}, webOnly: fs.readdirSync(WEB).filter(f => f.endsWith('.js') && !fs.existsSync(path.join(AND, f))), androidOnly: fs.readdirSync(AND).filter(f => f.endsWith('.js') && !fs.existsSync(path.join(WEB, f))) };
for (const f of shared) {
  try {
    const a = ast(path.join(WEB, f)), b = ast(path.join(AND, f));
    const identical = hash(a) === hash(b);
    const ta = top(parseFile(path.join(WEB, f))), tb = top(parseFile(path.join(AND, f)));
    const named = new Map(tb.map(x => [`${x.type}:${x.name}`, x.h]));
    const changed = ta.filter(x => named.has(`${x.type}:${x.name}`) && named.get(`${x.type}:${x.name}`) !== x.h && x.name).map(x => x.name);
    const missingInAndroid = ta.filter(x => x.name && !named.has(`${x.type}:${x.name}`)).map(x => x.name);
    const addedInAndroid = tb.filter(x => x.name && !ta.some(y => y.type === x.type && y.name === x.name)).map(x => x.name);
    report.files[f] = { identical, topLevelStatements: [ta.length, tb.length], changedDeclarations: changed, missingInAndroid, addedInAndroid };
  } catch (e) { report.files[f] = { error: String(e.message).slice(0, 160) }; }
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ast-compare.json'), JSON.stringify(report, null, 2));
for (const [f, r] of Object.entries(report.files)) console.log(f.padEnd(18), r.error ? 'ERROR ' + r.error : r.identical ? 'identical' : `DIFFERS changed=[${r.changedDeclarations.join(',')}] missing=[${r.missingInAndroid.join(',')}] added=[${r.addedInAndroid.join(',')}]`);
console.log('web-only:', report.webOnly.join(', '), '| android-only:', report.androidOnly.join(', '));
