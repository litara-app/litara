// Browser playback of the synthetic audio corpus (T007 F5): for each recording the original is fetched with the bearer token
// (as the web player does), loaded into an <audio> element, played briefly and seeked. Run with the stack up from audio_corpus.py --keep:
//   node scripts/t007/audio_browser.mjs [chromium|firefox|webkit]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pw = createRequire(path.join(root, 'apps/web/package.json'))('@playwright/test');
const name = process.argv[2] || 'chromium';
const creds = JSON.parse(fs.readFileSync(path.join(root, '.tmp/t007/creds.json'), 'utf8'));
const base = creds.base + '/api/v1';
const login = await (await fetch(base + '/auth/native/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: creds.admin[0], password: creds.admin[1], deviceName: 'audio-browser' }) })).json();
const hdr = { authorization: 'Bearer ' + login.accessToken };
const recs = (await (await fetch(base + '/recordings?size=50', { headers: hdr })).json()).items;
const browser = await pw[name].launch();
const page = await browser.newPage();
await page.goto('about:blank');
const results = {};
for (const r of recs) {
  const d = await (await fetch(base + `/recordings/${r.id}`, { headers: hdr })).json();
  const f = d.files[0];
  const buf = Buffer.from(await (await fetch(creds.base + f.contentPath, { headers: hdr })).arrayBuffer()).toString('base64');
  results[r.title] = await page.evaluate(async ({ buf, mime }) => {
    const probe = document.createElement('audio');
    const canPlay = probe.canPlayType(mime);
    const bytes = Uint8Array.from(atob(buf), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('audio');
    a.preload = 'auto'; a.muted = true; a.src = url;
    const out = { canPlayType: canPlay };
    const wait = (ev, ms) => new Promise((res) => { const t = setTimeout(() => res(false), ms); a.addEventListener(ev, () => { clearTimeout(t); res(true); }, { once: true }); });
    const meta = await Promise.race([wait('loadedmetadata', 8000), new Promise((res) => a.addEventListener('error', () => res(false), { once: true }))]);
    out.metadata = meta; out.duration = Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : null;
    if (meta) {
      try { await a.play(); out.played = true; } catch (e) { out.played = false; out.playError = String(e.message || e).slice(0, 80); }
      await new Promise((r2) => setTimeout(r2, 700));
      out.advanced = a.currentTime > 0.2;
      a.currentTime = Math.max(0, (a.duration || 4) - 3);
      const seeked = await wait('seeked', 4000);
      out.seekedNearEnd = seeked && Math.abs(a.currentTime - ((a.duration || 4) - 3)) < 1.5;
    } else out.mediaError = a.error ? a.error.code : null;
    return out;
  }, { buf, mime: f.mimeType });
  results[r.title].mime = f.mimeType;
  const x = results[r.title];
  x.pass = !!(x.metadata && x.played && x.advanced && x.seekedNearEnd);
}
await browser.close();
const ver = name;
const out = { browser: ver, results };
fs.mkdirSync(path.join(root, 'research/t007/evidence/m4-corpus'), { recursive: true });
fs.writeFileSync(path.join(root, `research/t007/evidence/m4-corpus/audio-playback-${name}.json`), JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(results)) console.log(name, k.padEnd(18), v.mime.padEnd(11), 'canPlay=' + JSON.stringify(v.canPlayType), v.pass ? 'PASS' : 'FAIL ' + JSON.stringify({ m: v.metadata, p: v.played, a: v.advanced, s: v.seekedNearEnd, e: v.mediaError }));
