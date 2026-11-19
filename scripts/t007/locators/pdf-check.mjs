// PDF page-identity probe (MIT): what does the web engine (PDF.js 6.5.438, the pinned version) say about each page of the edge-case
// PDF? The result is compared by eye/by search with what the Android PdfRenderer shows for the same page index.
//   node scripts/t007/locators/pdf-check.mjs [--pdf edge.pdf] [--out research/t007/evidence/m1-locators]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const MOUNTS = { '/pdfjs/': 'apps/web/public/reader/vendor/pdfjs', '/fx/': '.tmp/t007/locator-fixtures' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>pdf</title>');
  const m = Object.keys(MOUNTS).find(k => url.startsWith(k));
  const f = m && path.join(root, MOUNTS[m], url.slice(m.length));
  if (!f || !fs.existsSync(f)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': f.endsWith('.mjs') || f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base + '/');
const info = await page.evaluate(async ([u]) => {
  const pdfjs = await import('/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ url: u }).promise;
  const labels = await doc.getPageLabels();
  const pages = [];
  for (let i = 0; i < doc.numPages; i++) {
    const p = await doc.getPage(i + 1);
    const text = (await p.getTextContent()).items.map(x => x.str).join(' ').trim();
    const v = p.getViewport({ scale: 1 });
    pages.push({ pageIndex: i, label: labels?.[i] ?? null, text, rotate: p.rotate, cropBoxView: p.view, unrotatedCropWidth: p.view[2] - p.view[0], unrotatedCropHeight: p.view[3] - p.view[1], viewportWidth: v.width, viewportHeight: v.height });
  }
  return { numPages: doc.numPages, pdfjsVersion: pdfjs.version, pages };
}, [`/fx/${arg('--pdf', 'edge.pdf')}`]);
const out = path.resolve(root, arg('--out', 'research/t007/evidence/m1-locators'));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'pdfjs-pages.json'), JSON.stringify(info, null, 2));
console.log('PDF.js', info.pdfjsVersion, 'pages', info.numPages);
for (const p of info.pages) console.log(`  index ${p.pageIndex} label=${p.label} text="${p.text}" rotate=${p.rotate} crop=${p.unrotatedCropWidth}x${p.unrotatedCropHeight} viewport=${p.viewportWidth}x${p.viewportHeight}`);
await browser.close();
server.close();
