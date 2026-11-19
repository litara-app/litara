// Ad-hoc probe: does resolving a CFI depend on what the engine has already loaded? (diagnostic for run.mjs failures)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const MOUNTS = { '/web/': 'apps/web/public/reader/vendor/foliate-js', '/android/': 'apps/android/app/src/main/assets/reader/foliate', '/book/': '.tmp/t007/locator-fixtures', '/': 'scripts/t007/locators' };
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.epub': 'application/epub+zip', '.fb2': 'application/x-fictionbook+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x').pathname;
  const m = Object.keys(MOUNTS).sort((a, b) => b.length - a.length).find(k => url.startsWith(k));
  const f = path.join(root, MOUNTS[m], url.slice(m.length));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const cfis = ['epubcfi(/6/4!/4,/10[c2emoji],/22[c2p4]/11:378)', 'epubcfi(/6/6!/4,/10[c3emoji],/20[c3p4]/11:446)', 'epubcfi(/6/4!/4/10[c2emoji]/1:5)', 'epubcfi(/6/4!/4/10/1:5)'];
for (const engine of ['web', 'android']) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await page.goto(`${base}/harness.html?engine=${engine}`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.api.open('/book/stress.epub', { fontPx: 16 }));
  console.log(engine, 'FRESH (only first page loaded)');
  for (const c of cfis) console.log('  ', c, '=>', JSON.stringify(await page.evaluate(c => window.api.resolve(c), c)).slice(0, 150));
  await page.evaluate(() => window.api.walk(60));
  console.log(engine, 'AFTER WALKING THE WHOLE BOOK');
  for (const c of cfis) console.log('  ', c, '=>', JSON.stringify(await page.evaluate(c => window.api.resolve(c), c)).slice(0, 150));
}
await browser.close();
server.close();
