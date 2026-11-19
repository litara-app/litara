// Cross-engine locator proof runner (MIT). Serves the pristine web Foliate engine and the preserved Android Foliate engine side by
// side, loads each in its own Chromium page, and checks that a locator produced by one engine resolves to the same text in the other,
// including after viewport and font-size changes.
//
//   node scripts/t007/locators/run.mjs [--out research/t007/evidence/m1-locators]
//
// Requires apps/web dependencies (Playwright + its Chromium) and python-generated fixtures (make_fixtures.py).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const MOUNTS = {
  '/web/': path.join(root, 'apps/web/public/reader/vendor/foliate-js'),
  '/android/': path.join(root, 'apps/android/app/src/main/assets/reader/foliate'),
  '/book/': path.join(root, '.tmp/t007/locator-fixtures'),
  '/': here,
};
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.epub': 'application/epub+zip', '.fb2': 'application/x-fictionbook+xml', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x').pathname;
  const mount = Object.keys(MOUNTS).sort((a, b) => b.length - a.length).find(m => url.startsWith(m));
  const file = path.normalize(path.join(MOUNTS[mount], url.slice(mount.length)));
  if (!file.startsWith(MOUNTS[mount]) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const outDir = path.resolve(root, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'research/t007/evidence/m1-locators');
fs.mkdirSync(outDir, { recursive: true });

const PROFILES = {
  L1: { width: 320, height: 520, fontPx: 17 },
  L2: { width: 820, height: 1100, fontPx: 24 },
  L3: { width: 360, height: 640, fontPx: 12 },
};

const browser = await chromium.launch();
const pages = {};
for (const e of ['web', 'android']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  p.on('pageerror', err => console.error(`[${e}] pageerror`, err.message));
  await p.goto(`${base}/harness.html?engine=${e}`);
  await p.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  pages[e] = p;
}
const open = async (e, url, prof) => {
  await pages[e].setViewportSize({ width: prof.width, height: prof.height });
  await pages[e].waitForTimeout(400);
  return pages[e].evaluate(([u, o]) => window.api.open(u, o), [url, { fontPx: prof.fontPx }]);
};
const call = (e, fn, ...args) => pages[e].evaluate(([f, a]) => window.api[f](...a), [fn, args]);

const results = { generated: new Date().toISOString(), fixtures: {}, experiments: [] };
const tally = () => ({ total: 0, pass: 0, fail: 0, examples: [] });
const hasError = (...xs) => xs.some(x => !x || x.error);
const check = (t, ok, detail) => { t.total++; if (ok) t.pass++; else { t.fail++; if (t.examples.length < 40) t.examples.push(detail); } };
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

for (const fixture of process.argv.includes('--only-epub') ? ['stress.epub'] : process.argv.includes('--only-fb2') ? ['stress.fb2'] : ['stress.epub', 'stress.fb2']) {
  const url = `/book/${fixture}`;
  results.fixtures[fixture] = {};
  for (const [X, Y] of [['web', 'android'], ['android', 'web']]) {
    const tag = `${fixture} ${X}->${Y}`;
    const e1 = tally(), e1self = tally(), e2 = tally(), e2b = tally(), e3 = tally(), e4 = tally(), e5 = tally();

    // Positions produced by X under L1.
    const infoX = await open(X, url, PROFILES.L1);
    const positions = await call(X, 'walk', 400);
    // Self check of the offset helper: X resolves its own relocate cfi to the page start it reported.
    for (const p of positions) {
      const r = await call(X, 'resolve', p.cfi);
      check(e1self, !hasError(r) && r.index === p.index && r.start === p.start, { cfi: p.cfi, reported: [p.index, p.start], resolved: [r.index, r.start] });
    }
    const xres = [];
    for (const p of positions) xres.push(await call(X, 'resolve', p.cfi));

    // Y under a different viewport and font size (layout change).
    await open(Y, url, process.argv.includes('--same-layout') ? PROFILES.L1 : PROFILES.L2);
    const yres = [];
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const yr = await call(Y, 'resolve', p.cfi);
      yres.push(yr);
      check(e1, !hasError(yr, xres[i]) && yr.index === xres[i].index && yr.start === xres[i].start && yr.text === xres[i].text, { cfi: p.cfi, x: xres[i], y: yr });
    }
    // Y navigates to X's locator: the target text must be on the page Y shows (E2), at a different layout.
    const yShown = [];
    for (let i = 0; i < positions.length; i++) {
      const g = await call(Y, 'go', positions[i].cfi);
      yShown.push(g);
      const t = xres[i].start;
      check(e2, !hasError(g, xres[i]) && g.index === xres[i].index && g.start <= t && t < Math.max(g.end, g.start + 1), { cfi: positions[i].cfi, target: xres[i], shown: g });
    }
    // And back: the cfi Y reports is taken to a third layout in X and still contains the same text (E2b).
    await open(X, url, PROFILES.L3);
    for (let i = 0; i < yShown.length; i++) {
      const g = await call(X, 'go', yShown[i].cfi);
      const t = yres[i].start; // the original target
      // Y's page start may be before the target; the target must be within or after-by-less-than-a-page from that start.
      const startsAtOrBefore = g.index === yShown[i].index && g.start <= Math.max(yShown[i].start, t) + 1;
      check(e2b, !hasError(g, yShown[i], xres[i]) && startsAtOrBefore && g.index === xres[i].index, { yCfi: yShown[i].cfi, target: xres[i], yShown: yShown[i], xShown: g });
    }

    // Range locators (what highlights use): same text range, and identical CFI strings, from both engines.
    await open(X, url, PROFILES.L1);
    await open(Y, url, PROFILES.L1);
    const lens = await call(X, 'sectionLengths');
    const rand = rng(7);
    for (let s = 0; s < lens.length; s++) {
      if (lens[s] < 200) continue;
      for (let k = 0; k < 14; k++) {
        const a = Math.floor(rand() * (lens[s] - 120));
        const b = a + 3 + Math.floor(rand() * 90);
        const cx = await call(X, 'rangeCFI', s, a, b);
        if (!cx) continue;
        const rY = await call(Y, 'resolve', cx.cfi);
        check(e3, !hasError(rY) && rY.index === s && rY.start === a && rY.end === b && rY.text === cx.text.slice(0, 200), { section: s, a, b, cfi: cx.cfi, x: cx.text.slice(0, 60), y: rY });
        const cy = await call(Y, 'rangeCFI', s, a, b);
        check(e4, !!cy && cy.cfi === cx.cfi, { section: s, a, b, x: cx.cfi, y: cy?.cfi });
        // A collapsed point (what a bookmark or position start uses).
        const px = await call(X, 'rangeCFI', s, a, a);
        const pr = px && await call(Y, 'resolve', px.cfi);
        check(e5, !!pr && !pr.error && pr.index === s && pr.start === a, { section: s, a, cfi: px?.cfi, y: pr });
      }
    }

    results.fixtures[fixture][`${X}->${Y}`] = {
      sections: infoX.sections, pagesWalked: positions.length,
      E0_self_resolve: e1self, E1_resolve_same_text_after_layout_change: e1, E2_target_on_shown_page_after_layout_change: e2,
      E2b_round_trip_to_third_layout: e2b, E3_range_same_text_and_offsets: e3, E4_range_cfi_strings_identical: e4, E5_collapsed_point_resolves: e5,
    };
    console.log(tag, JSON.stringify(Object.fromEntries(Object.entries(results.fixtures[fixture][`${X}->${Y}`]).filter(([, v]) => v?.total !== undefined).map(([k, v]) => [k.split('_')[0], `${v.pass}/${v.total}`]))));
  }
}

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
server.close();
