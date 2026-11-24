// Shared-engine locator fixtures (ADR-0093 step 2, MIT). Question: do locators saved by the legacy Android reader engine
// (the AGPL-modified Foliate in apps/android/.../assets/reader) resolve to the same place in the shared engine (the pristine
// web engine, as bundled in apps/android/.../assets/reader-shared)? Nothing is relabelled as compatible: this reports.
//
//   node scripts/android/reader-locators/check.mjs record   # re-generate saved-locators.json FROM THE LEGACY ENGINE (rarely)
//   node scripts/android/reader-locators/check.mjs          # resolve the saved locators in both engines and report
//
// The harness page and probe API are reused from scripts/t007/locators (they only drive an engine served at test time).
// Needs apps/web dependencies (Playwright + Chromium). Exit code 1 when the shared engine disagrees with a saved locator.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const mode = process.argv[2] === 'record' ? 'record' : 'check';
const assets = path.join(root, 'apps/android/app/src/main/assets');
const MOUNTS = {
  '/shared/': path.join(assets, 'reader-shared/vendor/foliate-js'),
  '/legacy/': path.join(assets, 'reader/foliate'),
  '/pdfjs/': path.join(assets, 'reader-shared/vendor/pdfjs'),
  '/book/': path.join(here, 'fixtures'),
  '/': path.join(root, 'scripts/t007/locators'),
};
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.epub': 'application/epub+zip', '.fb2': 'application/x-fictionbook+xml', '.pdf': 'application/pdf', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const mount = Object.keys(MOUNTS).sort((a, b) => b.length - a.length).find(m => url.startsWith(m));
  const file = path.normalize(path.join(MOUNTS[mount], url.slice(mount.length)));
  if (!file.startsWith(MOUNTS[mount]) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const LAYOUT = {
  L1: { width: 320, height: 520, fontPx: 17 }, // where positions are saved
  L3: { width: 360, height: 640, fontPx: 12 }, // a second saving layout
  L2: { width: 820, height: 1100, fontPx: 24 }, // where they are read back (a different device / font size)
};
const BOOKS = ['stress.epub', 'stress.fb2'];
const savedFile = path.join(here, 'saved-locators.json');
const browser = await chromium.launch();
const pages = {};
for (const e of ['legacy', 'shared']) {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  p.on('pageerror', err => console.error(`[${e}] pageerror`, err.message));
  await p.goto(`${base}/harness.html?engine=${e}`);
  await p.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  pages[e] = p;
}
const open = async (e, book, lay) => {
  await pages[e].setViewportSize({ width: lay.width, height: lay.height });
  await pages[e].waitForTimeout(300);
  return pages[e].evaluate(([u, o]) => window.api.open(u, o), [`/book/${book}`, { fontPx: lay.fontPx }]);
};
const call = (e, fn, ...args) => pages[e].evaluate(([f, a]) => window.api[f](...a), [fn, args]);
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

if (mode === 'record') {
  const saved = { recordedBy: 'legacy Android engine (apps/android/app/src/main/assets/reader/foliate)', recordedAt: new Date().toISOString().slice(0, 10), books: {} };
  for (const book of BOOKS) {
    const out = (saved.books[book] = { positions: [], ranges: [], points: [] });
    for (const [name, lay] of [['L1', LAYOUT.L1], ['L3', LAYOUT.L3]]) {
      await open('legacy', book, lay);
      for (const p of await call('legacy', 'walk', 400)) {
        const r = await call('legacy', 'resolve', p.cfi);
        if (!r.error) out.positions.push({ layout: name, cfi: p.cfi, index: r.index, start: r.start, text: r.text });
      }
    }
    await open('legacy', book, LAYOUT.L1);
    const lens = await call('legacy', 'sectionLengths');
    const rand = rng(7);
    for (let s = 0; s < lens.length; s++) {
      if (lens[s] < 200) continue;
      for (let k = 0; k < 14; k++) {
        const a = Math.floor(rand() * (lens[s] - 120));
        const b = a + 3 + Math.floor(rand() * 90);
        const c = await call('legacy', 'rangeCFI', s, a, b);
        const pt = await call('legacy', 'rangeCFI', s, a, a);
        if (c && !c.error) {
          const r = await call('legacy', 'resolve', c.cfi);
          if (!r.error) out.ranges.push({ cfi: c.cfi, index: r.index, start: r.start, end: r.end, text: r.text });
        }
        if (pt && !pt.error) out.points.push({ cfi: pt.cfi, index: s, start: a });
      }
    }
    console.log(book, 'recorded', out.positions.length, 'positions', out.ranges.length, 'ranges', out.points.length, 'points');
  }
  fs.writeFileSync(savedFile, JSON.stringify(saved, null, 1) + '\n');
  await browser.close();
  server.close();
  process.exit(0);
}

// ---- check ----
const saved = JSON.parse(fs.readFileSync(savedFile, 'utf8'));
const report = { generated: new Date().toISOString(), savedBy: saved.recordedBy, readAt: 'L2 (820x1100, 24px); saved at L1/L3 (320x520 17px, 360x640 12px)', epub_fb2: {}, pdf: {} };
const tally = () => ({ total: 0, pass: 0, fail: 0, examples: [] });
const rec = (t, pass, detail) => { t.total++; if (pass) t.pass++; else { t.fail++; if (t.examples.length < 8) t.examples.push(detail); } };
const ok = r => r && !r.error;
let anyFail = false;
for (const book of BOOKS) {
  const s = saved.books[book];
  report.epub_fb2[book] = {};
  for (const e of ['legacy', 'shared']) {
    const T = { positions_same_text: tally(), positions_shown_on_page: tally(), ranges_same_text_and_offsets: tally(), points_same_offset: tally() };
    await open(e, book, LAYOUT.L2);
    for (const p of s.positions) {
      const r = await call(e, 'resolve', p.cfi);
      rec(T.positions_same_text, ok(r) && r.index === p.index && r.start === p.start && r.text === p.text, { cfi: p.cfi, saved: [p.index, p.start], got: r });
      const g = await call(e, 'go', p.cfi);
      rec(T.positions_shown_on_page, ok(g) && g.index === p.index && g.start <= p.start && p.start < Math.max(g.end, g.start + 1), { cfi: p.cfi, saved: [p.index, p.start], shown: g });
    }
    await open(e, book, LAYOUT.L2);
    for (const r0 of s.ranges) {
      const r = await call(e, 'resolve', r0.cfi);
      rec(T.ranges_same_text_and_offsets, ok(r) && r.index === r0.index && r.start === r0.start && r.end === r0.end && r.text === r0.text, { cfi: r0.cfi, saved: [r0.index, r0.start, r0.end], got: r });
    }
    for (const p of s.points) {
      const r = await call(e, 'resolve', p.cfi);
      rec(T.points_same_offset, ok(r) && r.index === p.index && r.start === p.start, { cfi: p.cfi, saved: [p.index, p.start], got: r });
    }
    report.epub_fb2[book][e] = T;
    for (const t of Object.values(T)) if (e === 'shared' && t.fail) anyFail = true;
  }
}

// PDF: a page locator is { kind: 'pdf-page', pageIndex } (0-based). The Android PDF reader is native (PdfRenderer) and never
// loaded Foliate; its saved forms are the 1-based page number and a percentage that PdfProgress.fractionToPage maps back.
const pdfPage = await (await browser.newContext()).newPage();
await pdfPage.goto(`${base}/harness.html?engine=shared`);
const pdf = await pdfPage.evaluate(async () => {
  const pdfjs = await import('/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ url: '/book/edge.pdf' }).promise;
  const pages = [];
  for (let i = 0; i < doc.numPages; i++) pages.push((await (await doc.getPage(i + 1)).getTextContent()).items.map(x => x.str).join(' ').trim());
  return { version: pdfjs.version, numPages: doc.numPages, pages };
});
const fractionToPage = (f, n) => Math.min(n - 1, Math.max(0, Math.round(f * n) - 1)); // mirrors PdfProgress.fractionToPage
const pdfT = { pdfjs_page_i_is_PAGE_i_plus_1: tally(), android_percentage_roundtrip: tally() };
for (let i = 0; i < pdf.numPages; i++) {
  rec(pdfT.pdfjs_page_i_is_PAGE_i_plus_1, pdf.pages[i] === `PAGE ${i + 1}`, { pageIndex: i, text: pdf.pages[i] });
  const fraction = (i + 1) / pdf.numPages; // PdfProgress.pageToPercentage / 100
  rec(pdfT.android_percentage_roundtrip, fractionToPage(fraction, pdf.numPages) === i, { pageIndex: i, back: fractionToPage(fraction, pdf.numPages) });
}
report.pdf = {
  fixture: 'edge.pdf (7 pages: inherited MediaBox, mixed sizes, /Rotate 90 and 270, CropBox, labels i, ii, 1..5)',
  pdfjs: pdf.version,
  ...pdfT,
  notRunHere: 'Android PdfRenderer page order for the same file needs the emulator (see research/t007/evidence/m1-locators/pdf-device).',
};
for (const t of Object.values(pdfT)) if (t.fail) anyFail = true;

const outDir = path.join(root, 'research/android/adr-0093');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'locator-results.json'), JSON.stringify(report, null, 1) + '\n');
for (const [book, per] of Object.entries(report.epub_fb2)) {
  for (const [e, T] of Object.entries(per)) console.log(`${book.padEnd(11)} ${e.padEnd(7)} ` + Object.entries(T).map(([k, t]) => `${k}: ${t.pass}/${t.total}`).join('  '));
}
console.log('pdf', Object.entries(pdfT).map(([k, t]) => `${k}: ${t.pass}/${t.total}`).join('  '));
await browser.close();
server.close();
process.exit(anyFail ? 1 : 0);
