// On-device locator proof (MIT): drives the Android reader's REAL WebView over DevTools (debug build, emulator) and the pinned web
// engine in desktop Chromium on the SAME EPUB file, and cross-resolves locators in both directions.
//
// Prerequisites: the emulator has the Litara debug app open on the book "Synthetic Tale" (so its reader WebView exists); the file
// served as /media/Synthetic Tale.epub must be byte-identical to the one the app downloaded (it is the stack's synthetic EPUB).
//   node scripts/t007/locators/device-check.mjs [--serial emulator-5554] [--book "Synthetic Tale.epub"]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const serial = arg('--serial', 'emulator-5554');
const bookName = arg('--book', 'Synthetic Tale.epub');
const adb = path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe');

const MOUNTS = { '/web/': 'apps/web/public/reader/vendor/foliate-js', '/media/': '.tmp/t007/media/Synthetic Author', '/': 'scripts/t007/locators' };
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.epub': 'application/epub+zip' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const m = Object.keys(MOUNTS).sort((a, b) => b.length - a.length).find(k => url.startsWith(k));
  const f = path.join(root, MOUNTS[m], url.slice(m.length));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// --- attach to the phone's reader WebView -------------------------------------------------------------------------------
const unix = execFileSync(adb, ['-s', serial, 'shell', 'cat /proc/net/unix'], { encoding: 'utf8' });
const sock = [...unix.matchAll(/@(webview_devtools_remote_\d+)/g)].map(m => m[1]).pop();
if (!sock) throw new Error('no WebView DevTools socket: open a book in the debug app first');
execFileSync(adb, ['-s', serial, 'forward', 'tcp:9333', `localabstract:${sock}`]);
const browser = await chromium.launch();
const devBrowser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const devPage = devBrowser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('reader'));
if (!devPage) throw new Error('reader page not found; pages: ' + devBrowser.contexts().flatMap(c => c.pages()).map(p => p.url()).join(', '));
await devPage.addScriptTag({ content: fs.readFileSync(path.join(here, 'api.js'), 'utf8') });
const deviceInfo = await devPage.evaluate(() => {
  window.__api = window.makeLocatorApi(() => document.getElementById('foliate'));
  const v = document.getElementById('foliate');
  return { userAgent: navigator.userAgent, hasView: !!v, sections: v?.book?.sections?.length, lastCfi: v?.lastLocation?.cfi };
});
if (!deviceInfo.hasView) throw new Error('no <foliate-view id="foliate"> in the reader page');

// --- the web engine in desktop Chromium --------------------------------------------------------------------------------
const webPage = await (await browser.newContext({ viewport: { width: 320, height: 520 } })).newPage();
await webPage.goto(`${base}/harness.html?engine=web`);
await webPage.waitForFunction(() => window.ready === true);
const webInfo = await webPage.evaluate(u => window.api.open(u, { fontPx: 17 }), `/media/${encodeURIComponent(bookName)}`);
const D = (fn, ...a) => devPage.evaluate(([f, x]) => window.__api[f](...x), [fn, a]);
const W = (fn, ...a) => webPage.evaluate(([f, x]) => window.api[f](...x), [fn, a]);

const tally = () => ({ total: 0, pass: 0, fail: 0, examples: [] });
const hasError = (...xs) => xs.some(x => !x || x.error);
const check = (t, ok, detail) => { t.total++; if (ok) t.pass++; else { t.fail++; if (t.examples.length < 20) t.examples.push(detail); } };
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const R = { generated: new Date().toISOString(), device: { serial, ...deviceInfo, socket: sock }, web: webInfo, book: bookName };
const d1 = tally(), d1go = tally(), d2 = tally(), d2go = tally(), d3 = tally(), d3str = tally(), d3pt = tally();

// D1: positions produced by the WEB engine -> the phone's engine resolves them to the same text and shows them.
const webPos = await W('walk', 40);
const webRes = [];
for (const p of webPos) webRes.push(await W('resolve', p.cfi));
for (let i = 0; i < webPos.length; i++) {
  const dr = await D('resolve', webPos[i].cfi);
  check(d1, !hasError(dr, webRes[i]) && dr.index === webRes[i].index && dr.start === webRes[i].start && dr.text === webRes[i].text, { cfi: webPos[i].cfi, web: webRes[i], device: dr });
  const g = await D('go', webPos[i].cfi);
  const t = webRes[i].start;
  check(d1go, !hasError(g, webRes[i]) && g.index === webRes[i].index && g.start <= t && t < Math.max(g.end, g.start + 1), { cfi: webPos[i].cfi, target: webRes[i], devicePage: g });
}

// D2: positions produced by the PHONE's engine (at a larger font) -> the web engine resolves/shows them.
await D('setFont', 28);
const devPos = await D('walk', 40);
for (let i = 1; i < 40; i++) { // plus landing points of 40 spread-out fractions, so the sample covers the whole book
  const g = await D('goFraction', i / 40);
  if (g && g.cfi && !devPos.some(p => p.cfi === g.cfi)) devPos.push(g);
}
for (const p of devPos) {
  const wr = await W('resolve', p.cfi);
  const dr = await D('resolve', p.cfi);
  check(d2, !hasError(wr, dr) && wr.index === dr.index && wr.start === dr.start && wr.text === dr.text, { cfi: p.cfi, web: wr, device: dr });
  const g = await W('go', p.cfi);
  check(d2go, !hasError(g, dr) && g.index === dr.index && g.start <= dr.start && dr.start < Math.max(g.end, g.start + 1), { cfi: p.cfi, target: dr, webPage: g });
}

// D3: ranges (what highlights use): identical CFI strings and identical text, both directions.
const lens = await W('sectionLengths');
const rand = rng(11);
for (let s = 0; s < lens.length; s++) {
  if (lens[s] < 200) continue;
  for (let k = 0; k < 12; k++) {
    const a = Math.floor(rand() * (lens[s] - 100));
    const b = a + 3 + Math.floor(rand() * 80);
    const cw = await W('rangeCFI', s, a, b);
    const cd = await D('rangeCFI', s, a, b);
    if (hasError(cw, cd)) { check(d3, false, { s, a, b, web: cw, device: cd }); continue; }
    check(d3str, cw.cfi === cd.cfi, { s, a, b, web: cw.cfi, device: cd.cfi });
    const rd = await D('resolve', cw.cfi);
    const rw = await W('resolve', cd.cfi);
    check(d3, !hasError(rd, rw) && rd.start === a && rd.end === b && rw.start === a && rw.end === b && rd.text === cw.text.slice(0, 200) && rw.text === cd.text.slice(0, 200), { s, a, b, web: cw.cfi, device: cd.cfi, rd, rw });
    const pw = await W('rangeCFI', s, a, a);
    const pd = pw && (await D('resolve', pw.cfi));
    check(d3pt, !!pd && !pd.error && pd.index === s && pd.start === a, { s, a, web: pw?.cfi, device: pd });
  }
}

R.results = {
  D1_web_positions_resolve_on_device: d1, D1b_device_shows_web_target: d1go,
  D2_device_positions_resolve_in_web: d2, D2b_web_shows_device_target: d2go,
  D3_ranges_same_text_both_ways: d3, D3b_range_cfi_strings_identical: d3str, D3c_collapsed_points_resolve_on_device: d3pt,
};
const out = path.resolve(root, arg('--out', 'research/t007/evidence/m1-locators'));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'device-results.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify({ ua: deviceInfo.userAgent.match(/Chrome\/[\d.]+/)?.[0], webPages: webPos.length, devicePages: devPos.length, ...Object.fromEntries(Object.entries(R.results).map(([k, v]) => [k.split('_')[0], `${v.pass}/${v.total}`])) }));
await devBrowser.close().catch(() => {});
await browser.close();
server.close();
execFileSync(adb, ['-s', serial, 'forward', '--remove', 'tcp:9333']);
