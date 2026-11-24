// Reader frame protocol check (MIT). Drives the real web reader frame (apps/web/public/reader/frame.html + bridge.js) from a minimal
// host page, with no Litara server, and checks the messages the Android app and the web app depend on: tap, in-book search,
// per-highlight colour and style, and the typography settings.
//
//   node scripts/web/reader-protocol/check.mjs
//
// Needs apps/web dependencies (Playwright + Chromium). Fixtures: scripts/android/reader-locators/fixtures (synthetic books).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const MOUNTS = { '/reader/': path.join(root, 'apps/web/public/reader'), '/book/': path.join(root, 'scripts/android/reader-locators/fixtures') };

const HOST = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
<iframe id=f></iframe><script>
window.events = []; let port, gen = 1, buf = null;
window.sendMsg = m => port.postMessage({ ...m, generation: gen });
window.load = async name => { buf = await (await fetch('/book/' + name)).arrayBuffer(); return buf.byteLength; };
const f = document.getElementById('f');
f.addEventListener('load', () => {
  const ch = new MessageChannel(); port = ch.port1;
  port.onmessage = e => {
    const m = e.data;
    if (m.t === 'range') { const b = buf.slice(m.start, m.end); port.postMessage({ t: 'range-data', generation: gen, id: m.id, buffer: b }, [b]); return; }
    window.events.push(m);
  };
  f.contentWindow.postMessage({ type: 'litara.reader.hello', channel: 'c', generation: gen }, location.origin, [ch.port2]);
});
f.src = '/reader/frame.html?parent=' + encodeURIComponent(location.origin);
window.view = () => f.contentDocument.querySelector('foliate-view');
</script>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') return void res.writeHead(200, { 'content-type': 'text/html' }).end(HOST);
  const m = Object.keys(MOUNTS).find(k => url.startsWith(k));
  const file = m && path.normalize(path.join(MOUNTS[m], url.slice(m.length)));
  if (!file || !file.startsWith(MOUNTS[m]) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); if (!ok) failures++; };

async function session(book, kind) {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 1000 } })).newPage();
  page.on('pageerror', e => console.log('  pageerror', e.message));
  await page.goto(base + '/');
  const size = await page.evaluate(n => window.load(n), book);
  await page.waitForFunction(() => window.events.some(e => e.t === 'ready'));
  await page.evaluate(([k, s, n]) => window.sendMsg({ t: 'open', kind: k, size: s, name: n, restore: {} }), [kind, size, book]);
  await page.waitForFunction(() => window.events.some(e => e.t === 'loaded' || e.t === 'error'), null, { timeout: 30000 });
  return page;
}
const events = (page, t) => page.evaluate(t => window.events.filter(e => e.t === t), t);
const waitFor = (page, t, extra = 'true', timeout = 15000) => page.waitForFunction(([t, extra]) => window.events.some(e => e.t === t && eval(extra)), [t, extra], { timeout });
const clear = page => page.evaluate(() => { window.events.length = 0; });

// ---- EPUB ----
{
  const page = await session('stress.epub', 'epub');
  check('epub loads', (await events(page, 'loaded'))[0]?.engine === 'foliate');
  await page.waitForTimeout(500);

  // tap: a click on plain text reports its position as fractions of the frame
  await clear(page);
  await page.mouse.click(600, 500);
  await waitFor(page, 'tap').catch(() => {});
  const taps = await events(page, 'tap');
  check('tap reported once with x,y fractions', taps.length === 1 && Math.abs(taps[0].x - 0.75) < 0.02 && Math.abs(taps[0].y - 0.5) < 0.02, taps);

  // search
  await clear(page);
  await page.evaluate(() => window.sendMsg({ t: 'search', query: 'harbour' }));
  await waitFor(page, 'search-done');
  const hits = (await events(page, 'search-results')).flatMap(e => e.items);
  const done = (await events(page, 'search-done'))[0];
  check('search finds matches with excerpts', hits.length > 5 && hits.every(h => h.cfi.startsWith('epubcfi(') && /harbour/i.test(h.match)), hits.slice(0, 2));
  check('search-done total equals hits', done.total === hits.length && done.capped === false, done);
  check('search reports progress', (await events(page, 'search-progress')).length > 0);
  await clear(page);
  await page.evaluate(() => window.sendMsg({ t: 'search', query: 'a', max: 40 }));
  await waitFor(page, 'search-done');
  const capped = (await events(page, 'search-done'))[0];
  check('search is capped at the requested maximum', capped.capped === true && capped.total === 40, capped);
  await page.evaluate(() => window.sendMsg({ t: 'clear-search' }));
  await clear(page);
  await page.evaluate(() => window.sendMsg({ t: 'search', query: '' }));
  await waitFor(page, 'search-done');
  check('empty query ends at once', (await events(page, 'search-done'))[0].total === 0);

  // per-highlight colour and style
  const cfi = 'epubcfi(/6/4!/4/8[c2p3],/11:167,/11:198)'; // recorded by the legacy Android engine
  await page.evaluate(c => window.sendMsg({ t: 'goto', cfi: c }), cfi);
  await page.waitForTimeout(1200);
  const overlay = () => page.evaluate(() => window.view().renderer.getContents().map(c => c.overlayer?.element.innerHTML ?? '').join('|'));
  await page.evaluate(c => window.sendMsg({ t: 'annotations', items: [{ id: 'a', cfi: c, kind: 'highlight' }] }), cfi);
  await page.waitForTimeout(800);
  const plain = await overlay();
  check('default highlight uses the kind colour', /ffd54a/i.test(plain), plain.slice(0, 200));
  await page.evaluate(c => window.sendMsg({ t: 'annotations', items: [{ id: 'a', cfi: c, kind: 'highlight', color: '#ff0000', style: 'underline' }] }), cfi);
  await page.waitForTimeout(800);
  const styled = await overlay();
  check('colour and style are applied', /ff0000/i.test(styled) && !/ffd54a/i.test(styled) && styled !== plain, styled.slice(0, 200));
  await page.evaluate(c => window.sendMsg({ t: 'annotations', items: [{ id: 'a', cfi: c, kind: 'highlight', color: 'url(javascript:1)', style: 'bogus' }] }), cfi);
  await page.waitForTimeout(800);
  check('an unsafe colour or unknown style falls back', /ffd54a/i.test(await overlay()));

  // clicking a highlight reports it with where it is, so a host can anchor a popup
  await page.evaluate(c => window.sendMsg({ t: 'annotations', items: [{ id: 'a', cfi: c, kind: 'highlight' }] }), cfi);
  await page.waitForTimeout(800);
  const hit = await page.evaluate(c => {
    const v = window.view(), x = v.resolveCFI(c), ct = v.renderer.getContents().find(k => k.index === x.index);
    const b = x.anchor(ct.doc).getClientRects()[0], f = ct.doc.defaultView.frameElement.getBoundingClientRect();
    return { x: b.left + b.width / 2 + f.left, y: b.top + b.height / 2 + f.top };
  }, cfi);
  await clear(page);
  await page.mouse.click(hit.x, hit.y);
  await waitFor(page, 'annotation-click').catch(() => {});
  const ac = await events(page, 'annotation-click');
  const rc = ac[0]?.rect;
  check('highlight click carries its rectangle', ac.length === 1 && ac[0].id === 'a' && rc && rc.width > 0 && rc.height > 0 && Math.abs(rc.x + rc.width / 2 - hit.x) < rc.width && Math.abs(rc.y + rc.height / 2 - hit.y) < rc.height + 2, ac);
  check('a highlight click is not also reported as a tap', (await events(page, 'tap')).length === 0);

  // typography
  await page.evaluate(() => window.sendMsg({ t: 'style', fontPct: 100, theme: 'light', flow: 'paginated', lineHeight: 2, justify: true, hyphenate: true, maxColumns: 1, gapPct: 10, maxInlineSize: 600 }));
  await page.waitForTimeout(1200);
  const typo = await page.evaluate(() => {
    const v = window.view();
    const c = v.renderer.getContents()[0];
    const p = c.doc.querySelector('p');
    const cs = c.doc.defaultView.getComputedStyle(p);
    return { lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), align: cs.textAlign, hyphens: cs.hyphens, cols: v.renderer.getAttribute('max-column-count'), gap: v.renderer.getAttribute('gap'), inline: v.renderer.getAttribute('max-inline-size') };
  });
  check('line height, justify, hyphenation applied', Math.abs(typo.lh - 2) < 0.05 && typo.align === 'justify' && typo.hyphens === 'auto', typo);
  check('columns, gap and text width applied', typo.cols === '1' && typo.gap === '10%' && typo.inline === '600px', typo);
  await page.evaluate(() => window.sendMsg({ t: 'style', fontPct: 100, theme: 'light', flow: 'paginated', justify: false, hyphenate: false }));
  await page.waitForTimeout(800);
  const off = await page.evaluate(() => { const c = window.view().renderer.getContents()[0]; const cs = c.doc.defaultView.getComputedStyle(c.doc.querySelector('p')); return { align: cs.textAlign, hyphens: cs.hyphens }; });
  await page.evaluate(() => window.sendMsg({ t: 'style', fontPct: 100, theme: 'light', flow: 'paginated' }));
  await page.waitForTimeout(800);
  const gone = await page.evaluate(() => { const r = window.view().renderer; return { cols: r.getAttribute('max-column-count'), gap: r.getAttribute('gap'), inline: r.getAttribute('max-inline-size') }; });
  check('fields left out withdraw earlier layout values', gone.cols === null && gone.gap === null && gone.inline === null, gone);
  check('justify and hyphenation switch off', off.align !== 'justify' && off.hyphens === 'manual', off);
  await page.context().close();
}

// ---- PDF ----
{
  const page = await session('edge.pdf', 'pdf');
  check('pdf loads', (await events(page, 'loaded'))[0]?.engine === 'pdfjs');
  await page.waitForTimeout(500);
  await clear(page);
  await page.mouse.click(300, 400);
  await waitFor(page, 'tap').catch(() => {});
  const t = await events(page, 'tap');
  check('pdf tap reported', t.length === 1 && Math.abs(t[0].x - 0.375) < 0.02, t);
  await clear(page);
  await page.evaluate(() => window.sendMsg({ t: 'search', query: 'PAGE' }));
  await waitFor(page, 'search-done');
  check('pdf search is reported unsupported, not hung', (await events(page, 'search-done'))[0].unsupported === true);
  await page.context().close();
}

await browser.close();
server.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
