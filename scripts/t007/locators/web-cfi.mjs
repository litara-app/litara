// Prints a Foliate CFI produced by the pristine WEB engine for a given book and book fraction, plus the text it lands on (MIT).
//   node scripts/t007/locators/web-cfi.mjs --book "Synthetic Tale.epub" --fraction 0.6
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
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
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/harness.html?engine=web`);
await page.waitForFunction(() => window.ready === true);
await page.evaluate(u => window.api.open(u, { fontPx: 17 }), `/media/${encodeURIComponent(arg('--book', 'Synthetic Tale.epub'))}`);
const g = await page.evaluate(f => window.api.goFraction(f), Number(arg('--fraction', '0.6')));
console.log(JSON.stringify({ cfi: g.cfi, index: g.index, start: g.start, snippet: g.snippet }));
await browser.close();
server.close();
