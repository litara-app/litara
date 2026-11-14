// Litara-owned reader bridge (MIT). It runs on the separate reader origin
// (ADR-0071), which holds no Litara credentials, and has no network
// privileges (CSP connect-src blob: only). All bytes arrive over a per-open
// MessageChannel from the authenticated parent (ADR-0067).
// Pristine upstream engines live in ./vendor and are never modified.

const MAX_RANGE = 8 * 1024 * 1024; // bytes per bridge reply
const MAX_OUTSTANDING = 2; // range requests in flight per open reader
const WHOLE_FILE_MAX = 32 * 1024 * 1024; // formats that cannot stream ranges
const DEFAULT_LIMITS = Object.freeze({
  entries: 10000,
  entryBytes: 100 * 1024 * 1024,
  expandedBytes: 8 * 1024 * 1024 * 1024,
  ratio: 200,
  ratioFloor: 1024 * 1024, // ratio applies once expansion exceeds 1 MiB
});

let port = null;
let channelId = null;
let generation = null;
let session = null; // active open state; replaced on every `open`
let nextId = 1;
const pending = new Map();
let outstanding = 0;
const waiters = [];

const send = msg => port?.postMessage(msg);
const fail = (code, detail) => send({ t: 'error', generation, code, detail: String(detail ?? '').slice(0, 200) });

// --- handshake -------------------------------------------------------------
// Accept exactly one hello from the embedding window carrying a port. The
// sender must be the parent window AND the exact application origin named in
// the frame URL (frame-ancestors enforces the same origin); the parent checks
// the per-open nonce and generation on the first reply.
const parentOrigin = new URLSearchParams(location.search).get('parent');
window.addEventListener('message', function onHello(event) {
  if (port || !parentOrigin || event.source !== window.parent || event.origin !== parentOrigin) return;
  const d = event.data;
  if (!d || d.type !== 'litara.reader.hello' || typeof d.channel !== 'string'
      || !Number.isSafeInteger(d.generation) || event.ports.length !== 1) return;
  window.removeEventListener('message', onHello);
  port = event.ports[0];
  channelId = d.channel;
  generation = d.generation;
  port.onmessage = onPortMessage;
  send({ t: 'ready', channel: channelId, generation });
});

function onPortMessage(event) {
  const m = event.data;
  if (!m || typeof m.t !== 'string' || m.generation !== generation) return; // stale/forged
  switch (m.t) {
    case 'open': return void open(m).catch(err => fail(err?.code ?? 'open_failed', err?.message));
    case 'range-data': return settle(m, m.buffer instanceof ArrayBuffer ? m.buffer : null);
    case 'range-error': return settle(m, null, m.code);
    case 'close': return void close();
    case 'goto': return void session?.goto?.(m).catch(err => fail(err?.code ?? 'goto_failed', err?.message));
    case 'nav': return void session?.nav?.(m.dir === 'prev' ? 'prev' : 'next');
    case 'style': return void session?.style?.(m);
    case 'annotations': return void session?.annotations?.(Array.isArray(m.items) ? m.items : []);
    case 'clear-selection': return void session?.clearSelection?.();
    default: return;
  }
}

function settle(m, buffer, code) {
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (p.kind === 'range') { outstanding--; waiters.shift()?.(); }
  if (buffer && buffer.byteLength <= p.max) p.resolve(buffer);
  else p.reject(Object.assign(new Error(code ?? 'bad_reply'), { code: code ?? 'bad_reply' }));
}

async function slot() {
  while (outstanding >= MAX_OUTSTANDING) await new Promise(r => waiters.push(r));
  outstanding++;
}

async function requestRange(start, end) {
  if (!(end > start) || end - start > MAX_RANGE) throw Object.assign(new Error('range too large'), { code: 'range_bounds' });
  await slot();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { kind: 'range', resolve, reject, max: end - start });
    send({ t: 'range', generation, id, start, end });
  });
}

async function readRange(size, offset, length) {
  const end = Math.min(size, offset + length);
  const out = new Uint8Array(Math.max(0, end - offset));
  for (let pos = offset; pos < end; pos += MAX_RANGE) {
    const to = Math.min(end, pos + MAX_RANGE);
    out.set(new Uint8Array(await requestRange(pos, to)), pos - offset);
  }
  return out;
}


const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);
const forwardKeys = target => target.addEventListener('keydown', e => {
  if (NAV_KEYS.has(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) send({ t: 'key', generation, key: e.key });
});
forwardKeys(window);

// --- open ------------------------------------------------------------------
function close() {
  session?.dispose?.();
  session = null;
  for (const p of pending.values()) p.reject(Object.assign(new Error('closed'), { code: 'closed' }));
  pending.clear();
  outstanding = 0;
  document.getElementById('stage').replaceChildren();
}

function lowerLimits(requested) {
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(out)) {
    const v = requested?.[k];
    if (Number.isFinite(v) && v > 0 && v < out[k]) out[k] = v; // operators may only lower
  }
  return out;
}

async function open(m) {
  close();
  const { kind, size, name } = m;
  const restore = m.restore && typeof m.restore === 'object' ? m.restore : {};
  if (!Number.isSafeInteger(size) || size <= 0 || typeof kind !== 'string') {
    throw Object.assign(new Error('bad open'), { code: 'bad_open' });
  }
  const limits = lowerLimits(m.limits);
  if (kind === 'epub' || kind === 'cbz') return openZip(kind, size, String(name ?? ''), limits, restore);
  if (kind === 'fb2') return openWhole(size, String(name ?? ''), restore);
  if (kind === 'pdf') return openPdf(size, restore);
  throw Object.assign(new Error('unsupported kind'), { code: 'unsupported_kind' });
}

class LimitError extends Error { constructor(code) { super(code); this.code = code; } }

async function makeBoundedZipLoader(size, limits) {
  const zip = await import('./vendor/foliate-js/vendor/zip.js');
  zip.configure({ useWebWorkers: false });
  // The vendored zip.js exports BlobReader but not its Reader base class;
  // subclass it and replace the blob-backed reads with bridge ranges.
  class RangeReader extends zip.BlobReader {
    constructor() { super(new Blob([])); this.size = size; }
    async init() { this.size = size; }
    async readUint8Array(offset, length) { return readRange(size, offset, length); }
  }
  const reader = new zip.ZipReader(new RangeReader());
  const entries = await reader.getEntries();
  if (entries.length > limits.entries) throw new LimitError('archive_limit');
  let total = 0;
  const map = new Map();
  for (const e of entries) {
    if (e.directory) continue;
    if (e.uncompressedSize > limits.entryBytes) throw new LimitError('archive_limit');
    total += e.uncompressedSize;
    if (total > limits.expandedBytes) throw new LimitError('archive_limit');
    if (map.has(e.filename)) throw new LimitError('unsupported_archive'); // duplicate identity
    map.set(e.filename, e);
  }
  if (total > limits.ratioFloor && total / size > limits.ratio) throw new LimitError('archive_limit');
  let streamed = 0;
  // Counting sink: enforces limits on actual decompressed bytes, not headers.
  const collect = async (entry, type) => {
    const chunks = [];
    let n = 0;
    const sink = new WritableStream({
      write(chunk) {
        n += chunk.byteLength;
        streamed += chunk.byteLength;
        if (n > limits.entryBytes || streamed > limits.expandedBytes) throw new LimitError('archive_limit');
        chunks.push(chunk);
      },
    });
    await entry.getData(sink);
    return new Blob(chunks, { type });
  };
  const load = f => (name, ...args) => (map.has(name) ? f(map.get(name), ...args) : null);
  return {
    entries: [...map.values()],
    loadText: load(async entry => (await collect(entry, 'text/plain')).text()),
    loadBlob: load((entry, type) => collect(entry, type)),
    getSize: name => map.get(name)?.uncompressedSize ?? 0,
  };
}

const THEMES = {
  light: { fg: '#1b1b1b', bg: '#ffffff' },
  sepia: { fg: '#3b2f1e', bg: '#f4ecd8' },
  dark: { fg: '#dddddd', bg: '#1e1e1e' },
};
const HIGHLIGHT = { highlight: '#ffd54a', note: '#7ec8ff' };

function toc(items, depth = 0) {
  if (!Array.isArray(items) || depth > 6) return [];
  return items.slice(0, 500).map(i => ({
    label: String(i.label ?? '').slice(0, 256),
    href: typeof i.href === 'string' ? i.href.slice(0, 1024) : null,
    items: toc(i.subitems, depth + 1),
  }));
}

async function mountFoliate(book, restore) {
  await import('./vendor/foliate-js/view.js');
  const { Overlayer } = await import('./vendor/foliate-js/overlayer.js');
  const view = document.createElement('foliate-view');
  document.getElementById('stage').append(view);
  let items = []; // [{id, cfi, kind}] painted highlights
  const byValue = new Map();
  let selTimer = 0;
  // Embedded links must never navigate; report them to the parent instead.
  view.addEventListener('external-link', e => { e.preventDefault(); send({ t: 'blocked-link', generation }); });
  view.addEventListener('relocate', e => {
    const { cfi, fraction, location, tocItem } = e.detail ?? {};
    send({ t: 'relocate', generation, cfi: typeof cfi === 'string' ? cfi.slice(0, 16384) : null,
      fraction: Number.isFinite(fraction) ? fraction : null, page: location?.current ?? null,
      tocLabel: typeof tocItem?.label === 'string' ? tocItem.label.slice(0, 256) : null });
  });
  view.addEventListener('draw-annotation', e => {
    const { draw, annotation } = e.detail;
    draw(Overlayer.highlight, { color: HIGHLIGHT[annotation.kind] ?? HIGHLIGHT.highlight });
  });
  view.addEventListener('show-annotation', e => {
    const id = byValue.get(e.detail.value);
    if (id) send({ t: 'annotation-click', generation, id });
  });
  view.addEventListener('load', e => {
    const { doc, index } = e.detail;
    forwardKeys(doc);
    doc.addEventListener('selectionchange', () => {
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const sel = doc.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return send({ t: 'selection', generation, cleared: true });
        const range = sel.getRangeAt(0);
        const text = range.toString();
        if (!text.trim()) return send({ t: 'selection', generation, cleared: true });
        send({ t: 'selection', generation, cfi: view.getCFI(index, range).slice(0, 16384), text: text.slice(0, 16384) });
      }, 250);
    });
  });
  await view.open(book);
  let restored = true;
  if (restore.cfi) {
    try { await view.init({ lastLocation: restore.cfi }); }
    catch { restored = false; }
    if (!restored) await view.init({ showTextStart: true });
  } else await view.init({ showTextStart: true });
  if (!restored) send({ t: 'restore-failed', generation }); // never substitute a percentage for an unresolved CFI

  const applyStyle = ({ fontPct, theme, flow }) => {
    const t = THEMES[theme] ?? THEMES.light;
    const pct = Number.isFinite(fontPct) ? Math.min(250, Math.max(60, fontPct)) : 100;
    document.documentElement.style.background = t.bg;
    view.renderer?.setAttribute?.('flow', flow === 'scrolled' ? 'scrolled' : 'paginated');
    view.renderer?.setStyles?.(`html { color: ${t.fg}; background: ${t.bg}; font-size: ${pct}% !important; } a { color: inherit; }`);
  };
  applyStyle({});
  const paint = async next => {
    for (const old of items) await view.deleteAnnotation({ value: old.cfi }).catch(() => {});
    items = next.slice(0, 2000).filter(i => typeof i?.cfi === 'string' && i.cfi.length <= 16384 && typeof i.id === 'string');
    byValue.clear();
    for (const i of items) {
      byValue.set(i.cfi, i.id);
      await view.addAnnotation({ value: i.cfi, kind: i.kind }).catch(() => {}); // an unresolved CFI is simply not painted
    }
  };
  session = {
    dispose: () => { clearTimeout(selTimer); view.close?.(); view.remove(); },
    async goto(m) {
      if (typeof m.cfi === 'string') return void (await view.goTo(m.cfi));
      if (typeof m.href === 'string') return void (await view.goTo(m.href));
      if (Number.isFinite(m.fraction)) return void (await view.goToFraction(Math.min(1, Math.max(0, m.fraction))));
    },
    async nav(dir) { await (dir === 'prev' ? view.prev() : view.next()); },
    style: applyStyle,
    annotations: paint,
    clearSelection: () => { for (const c of view.renderer?.getContents?.() ?? []) c.doc?.getSelection?.()?.removeAllRanges(); },
  };
  send({ t: 'toc', generation, items: toc(book.toc) });
  send({ t: 'loaded', generation, engine: 'foliate', sections: book.sections?.length ?? 0, title: typeof book.metadata?.title === 'string' ? book.metadata.title : null });
}

async function openZip(kind, size, name, limits, restore) {
  const loader = await makeBoundedZipLoader(size, limits);
  let book;
  if (kind === 'cbz') {
    const { makeComicBook } = await import('./vendor/foliate-js/comic-book.js');
    book = makeComicBook(loader, { name: name || 'book.cbz' });
  } else {
    const { EPUB } = await import('./vendor/foliate-js/epub.js');
    book = await new EPUB(loader).init();
  }
  await mountFoliate(book, restore);
}

async function openWhole(size, name, restore) {
  if (size > WHOLE_FILE_MAX) throw new LimitError('archive_limit');
  const bytes = await readRange(size, 0, size);
  const { makeFB2 } = await import('./vendor/foliate-js/fb2.js');
  await mountFoliate(await makeFB2(new File([bytes], name || 'book.fb2')), restore);
}

async function openPdf(size, restore) {
  const pdfjs = await import('./vendor/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
  const head = await readRange(size, 0, Math.min(size, 64 * 1024));
  const transport = new pdfjs.PDFDataRangeTransport(size, head);
  transport.requestDataRange = (begin, end) => {
    readRange(size, begin, end - begin).then(buf => transport.onDataRange(begin, buf), err => fail('range_failed', err.message));
  };
  const task = pdfjs.getDocument({
    range: transport, length: size, isEvalSupported: false, enableScripting: false,
    disableAutoFetch: true, disableStream: true, stopAtErrors: false,
  });
  const doc = await task.promise;
  const canvas = document.createElement('canvas');
  canvas.id = 'pdf';
  document.getElementById('stage').append(canvas);
  let current = -1;
  let busy = null;
  let style = { fontPct: 100, theme: 'light' };
  const show = async index => {
    const i = Math.min(doc.numPages - 1, Math.max(0, index));
    if (i === current && !busy) return;
    current = i;
    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(0.5, (style.fontPct / 100) * (Math.min(document.getElementById('stage').clientWidth || base.width, 1400) / base.width)));
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    document.getElementById('stage').scrollTop = 0;
    send({ t: 'relocate', generation, pageIndex: i, numPages: doc.numPages, cfi: null, fraction: doc.numPages > 1 ? i / (doc.numPages - 1) : 1, tocLabel: null });
  };
  const queue = fn => (busy = (busy ?? Promise.resolve()).then(fn).finally(() => { busy = null; }));
  let restored = true;
  const want = Number.isSafeInteger(restore.pageIndex) ? restore.pageIndex : 0;
  if (want >= doc.numPages) { restored = false; }
  await show(restored ? want : 0);
  if (!restored) send({ t: 'restore-failed', generation });
  session = {
    dispose: () => { task.destroy(); canvas.remove(); },
    goto: m => queue(() => show(Number.isSafeInteger(m.pageIndex) ? m.pageIndex : 0)),
    nav: dir => queue(() => show(current + (dir === 'prev' ? -1 : 1))),
    style: m => { style = { fontPct: Number.isFinite(m.fontPct) ? m.fontPct : 100, theme: m.theme }; document.documentElement.style.background = THEMES[m.theme]?.bg ?? '#fff'; return queue(() => { const c = current; current = -1; return show(c); }); },
    annotations: () => {}, // PDF highlights are not drawn in this milestone
    clearSelection: () => {},
  };
  send({ t: 'toc', generation, items: [] });
  send({ t: 'loaded', generation, engine: 'pdfjs', pages: doc.numPages });
}
