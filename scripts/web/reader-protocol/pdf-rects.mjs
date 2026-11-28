// PDF highlight rectangles in desktop browsers (MIT, ADR-0113). On every page of the synthetic edge-case PDF (rotated,
// cropped and differently sized pages) it selects the page's first line of text and drags one area box, through the real
// web reader frame. It checks two things:
//   1. Truth: the selection box sits on the text actually drawn. Agreement between browsers alone once passed while all of
//      them were wrong, because the text layer had no sizing styles.
//   2. Agreement with the recorded Chromium values, which the Android instrumentation test also compares against.
//
//   node scripts/web/reader-protocol/pdf-rects.mjs          check Chromium, Firefox and WebKit
//   node scripts/web/reader-protocol/pdf-rects.mjs --write  record Chromium's values again, then check
//
// Needs apps/web dependencies and Playwright browsers.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const browsers = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const fixtures = path.join(root, 'scripts/android/reader-locators/fixtures');
const recorded = path.join(fixtures, 'pdf-rects.json');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const MOUNTS = { '/reader/': path.join(root, 'apps/web/public/reader'), '/book/': fixtures };
// The area drag, as fractions of the drawn page. It stays in the top part so it is on screen even for the tallest page.
export const DRAG = { from: [0.2, 0.1], to: [0.7, 0.3] };
// Fractions of the page. "Along" is where a line of text starts and how long it is; "across" is the box's thickness
// direction, which follows each browser's font metrics (the owner accepted that small difference, ADR-0113).
const TOLERANCE = { along: 0.008, across: 0.016, area: 0.006 };
// Firefox's line boxes are a little taller than Chromium's, up to about 1.9% of the narrowest page.
const FIREFOX_ACROSS = 0.022;
// Against the drawn pixels: a box starts and ends within a glyph's side bearing of the ink, and holds all of it.
const INK = { along: 0.025, slack: 0.01 };
// The ink of the page's text and the box of the selection, both as fractions of the drawn page.
export const INK_SCRIPT = `(() => {
  const c = document.querySelector('canvas#pdf'), b = c.getBoundingClientRect();
  const s = getSelection().getRangeAt(0).getBoundingClientRect();
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let l = 1e9, t = 1e9, r = -1, u = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 300) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > u) u = y; }
  }
  return { ink: [l / c.width, t / c.height, (r + 1) / c.width, (u + 1) / c.height],
    // Text that runs off the page is cut off in the pixels, so the box is compared where it is on the page.
    box: [(s.left - b.left) / b.width, (s.top - b.top) / b.height, (s.right - b.left) / b.width, (s.bottom - b.top) / b.height]
      .map(v => Math.min(1, Math.max(0, v))) };
})()`;
const onTheInk = ({ ink, box }) => {
  const [a, c] = ink[2] - ink[0] >= ink[3] - ink[1] ? [0, 1] : [1, 0]; // the axis the line runs along
  const holds = box[c] <= ink[c] + INK.slack && box[c + 2] >= ink[c + 2] - INK.slack;
  return { ok: holds && Math.abs(box[a] - ink[a]) <= INK.along && Math.abs(box[a + 2] - ink[a + 2]) <= INK.along,
    detail: `start off by ${Math.abs(box[a] - ink[a]).toFixed(4)}, end off by ${Math.abs(box[a + 2] - ink[a + 2]).toFixed(4)}` };
};

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

const nextSelection = (page) => page.waitForFunction(() => window.events.find(e => e.t === 'selection' && e.pdf), null, { timeout: 15000 }).then(h => h.jsonValue());
const reset = page => page.evaluate(() => { window.events.length = 0; });

async function measure(name) {
  const browser = await browsers[name].launch();
  const page = await (await browser.newContext({ viewport: { width: 800, height: 1000 } })).newPage();
  await page.goto(base + '/');
  const size = await page.evaluate(() => window.load('edge.pdf'));
  await page.waitForFunction(() => window.events.some(e => e.t === 'ready'));
  await page.evaluate(s => window.sendMsg({ t: 'open', kind: 'pdf', size: s, name: 'edge.pdf', restore: {} }), size);
  const loaded = await page.waitForFunction(() => window.events.find(e => e.t === 'loaded'), null, { timeout: 30000 }).then(h => h.jsonValue());
  const frame = page.frames().find(f => f.url().includes('/reader/frame.html'));
  const out = [];
  for (let i = 0; i < loaded.pages; i++) {
    if (i > 0) {
      await reset(page);
      await page.evaluate(i => window.sendMsg({ t: 'goto', pageIndex: i }), i);
      await page.waitForFunction(i => window.events.some(e => e.t === 'relocate' && e.pageIndex === i), i);
    }
    await page.waitForTimeout(500);
    // The first line of text on the page, selected whole.
    await reset(page);
    const word = await frame.evaluate(() => {
      const span = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.trim().length > 1);
      if (!span) return null;
      const r = document.createRange();
      r.selectNodeContents(span);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return span.textContent;
    });
    let text = null;
    let ink = null;
    if (word !== null) {
      text = (await nextSelection(page)).pdf.rectangles;
      ink = await frame.evaluate(INK_SCRIPT);
    }
    await frame.evaluate(() => getSelection().removeAllRanges());
    await page.evaluate(() => window.sendMsg({ t: 'pdf-mode', mode: 'area' }));
    await page.waitForTimeout(200);
    await reset(page);
    const box = await frame.locator('canvas#pdf').boundingBox();
    await page.mouse.move(box.x + box.width * DRAG.from[0], box.y + box.height * DRAG.from[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * DRAG.to[0], box.y + box.height * DRAG.to[1], { steps: 8 });
    await page.mouse.up();
    const area = (await nextSelection(page)).pdf.rectangles;
    await page.evaluate(() => window.sendMsg({ t: 'pdf-mode', mode: 'off' }));
    await page.waitForTimeout(200);
    out.push({ pageIndex: i, word, text, area, ink });
  }
  await browser.close();
  return out;
}

const round = pages => pages.map(({ ink, ...p }) => ({ ...p, text: p.text?.map(fix) ?? null, area: p.area.map(fix) }));
const fix = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1e5) / 1e5]));
// The largest differences along and across each box; a line runs along the box's longer side.
const worst = (a, b) => a.reduce((w, r, i) => {
  const wide = r.width >= r.height;
  const along = Math.max(...(wide ? ['x', 'width'] : ['y', 'height']).map(k => Math.abs(r[k] - b[i][k])));
  const across = Math.max(...(wide ? ['y', 'height'] : ['x', 'width']).map(k => Math.abs(r[k] - b[i][k])));
  return { along: Math.max(w.along, along), across: Math.max(w.across, across) };
}, { along: 0, across: 0 });

let failures = 0;
if (process.argv.includes('--write')) fs.writeFileSync(recorded, JSON.stringify({ drag: DRAG, tolerance: TOLERANCE, pages: round(await measure('chromium')) }, null, 1) + '\n');
const expected = JSON.parse(fs.readFileSync(recorded, 'utf8'));
for (const name of ['chromium', 'firefox', 'webkit']) {
  const got = await measure(name);
  for (const want of expected.pages) {
    const have = got[want.pageIndex];
    const line = (ok, text) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} page ${want.pageIndex + 1} ${text}`); };
    if (have.ink) {
      const truth = onTheInk(have.ink);
      line(truth.ok, `selection is on the drawn text: ${truth.detail}`);
    }
    for (const kind of ['text', 'area']) {
      if (!want[kind] && !have[kind]) continue;
      if (!want[kind] || !have[kind] || want[kind].length !== have[kind].length) { line(false, `${kind}: different box count`); continue; }
      const d = worst(want[kind], have[kind]);
      const t = expected.tolerance;
      const across = name === 'firefox' ? FIREFOX_ACROSS : t.across;
      const ok = kind === 'area' ? Math.max(d.along, d.across) <= t.area : d.along <= t.along && d.across <= across;
      line(ok, `${kind}: differs from the record by ${d.along.toFixed(5)} along, ${d.across.toFixed(5)} across`);
    }
  }
}
server.close();
console.log(failures ? `${failures} FAILED` : 'all rectangles match');
process.exit(failures ? 1 : 0);
