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
    case 'fonts': return void session?.fonts?.(m);
    case 'locate': return void session?.locate?.(Array.isArray(m.items) ? m.items : []);
    case 'clear-selection': return void session?.clearSelection?.();
    case 'search': return void session?.search?.(m);
    case 'clear-search': return void session?.clearSearch?.();
    case 'pdf-mode': return void session?.pdfMode?.(m.mode === 'area' ? 'area' : 'off');
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
  if (kind === 'mobi') return openMobi(size, String(name ?? ''), restore);
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
// Reading fonts the reader offers. Publisher keeps the book's own; the others are common system stacks, so nothing is downloaded.
const FONTS = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
  // Bundled families arrive as bytes over the channel (ADR-0091) and are declared under these names.
  literata: '"Litara Literata", Georgia, serif',
  atkinson: '"Litara Atkinson Hyperlegible", system-ui, sans-serif',
  dyslexic: '"Litara OpenDyslexic", "Comic Sans MS", sans-serif',
  mono: 'ui-monospace, Consolas, "Courier New", monospace',
};
// Where a selection sits, in this frame's coordinates, so the parent can put its popup next to the text.
const rectOf = (range, el) => {
  const r = range.getBoundingClientRect();
  const f = el?.getBoundingClientRect?.();
  const n = v => (Number.isFinite(v) ? Math.round(v) : 0);
  return { x: n(r.left + (f?.left ?? 0)), y: n(r.top + (f?.top ?? 0)), width: n(r.width), height: n(r.height) };
};
const FAMILY = { literata: 'Litara Literata', atkinson: 'Litara Atkinson Hyperlegible', dyslexic: 'Litara OpenDyslexic' };
const HIGHLIGHT = { highlight: '#ffd54a', note: '#7ec8ff' };
// Per-annotation appearance is optional: a CSS hex colour and one of the overlay styles. Anything else falls back to the kind's default.
const DRAW_STYLES = new Set(['highlight', 'underline', 'squiggly', 'strikethrough']);
const safeColor = c => (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null);
const safeStyle = s => (DRAW_STYLES.has(s) ? s : 'highlight');
const MAX_SEARCH_HITS = 500;
const clampNum = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
// Where a tap landed, as fractions of this frame, so the parent can map screen zones (edges turn the page, the middle toggles chrome).
const tapPoint = (e, el) => {
  const f = el?.getBoundingClientRect?.();
  const w = window.innerWidth || 1, h = window.innerHeight || 1;
  return { x: clampNum(((e.clientX ?? 0) + (f?.left ?? 0)) / w, 0, 1) ?? 0, y: clampNum(((e.clientY ?? 0) + (f?.top ?? 0)) / h, 0, 1) ?? 0 };
};

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
  let searchToken = 0;
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
    draw(Overlayer[safeStyle(annotation.style)], { color: safeColor(annotation.color) ?? HIGHLIGHT[annotation.kind] ?? HIGHLIGHT.highlight });
  });
  let lastAnnotationClick = 0;
  view.addEventListener('show-annotation', e => {
    const id = byValue.get(e.detail.value);
    if (!id) return;
    lastAnnotationClick = Date.now();
    // Where the highlight is, in the frame's own pixels (same space as a selection's rect), so a host can anchor a popup to it.
    let rect;
    try { const r = e.detail.range; rect = r ? rectOf(r, r.startContainer?.ownerDocument?.defaultView?.frameElement) : undefined; } catch { /* no anchor */ }
    send({ t: 'annotation-click', generation, id, rect });
  });
  view.addEventListener('load', e => {
    const { doc, index } = e.detail;
    forwardKeys(doc);
    // A tap on plain text: not on a link, not ending a selection, not on a highlight. Reported after a beat so the
    // highlight click (which arrives from the overlay) can claim it first.
    doc.addEventListener('click', e => {
      if (e.defaultPrevented || e.button > 0 || e.target?.closest?.('a[href]')) return;
      if (doc.getSelection()?.isCollapsed === false) return;
      const at = tapPoint(e, doc.defaultView?.frameElement);
      setTimeout(() => { if (Date.now() - lastAnnotationClick > 100) send({ t: 'tap', generation, ...at }); }, 30);
    });
    doc.addEventListener('selectionchange', () => {
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const sel = doc.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return send({ t: 'selection', generation, cleared: true });
        const range = sel.getRangeAt(0);
        const text = range.toString();
        if (!text.trim()) return send({ t: 'selection', generation, cleared: true });
        send({ t: 'selection', generation, cfi: view.getCFI(index, range).slice(0, 16384), text: text.slice(0, 16384), rect: rectOf(range, doc.defaultView?.frameElement) });
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

  let lastStyle = {};
  const faceCss = {};
  const fontUrls = [];
  const applyStyle = (s = {}) => {
    lastStyle = s;
    const { fontPct, theme, flow, font } = s;
    const lineHeight = clampNum(s.lineHeight, 0.8, 3);
    const cols = clampNum(s.maxColumns, 1, 4);
    const gapPct = clampNum(s.gapPct, 0, 20);
    const inline = clampNum(s.maxInlineSize, 300, 2000);
    // Absent means "the engine's own default": a value the reader sent earlier is withdrawn, not left behind.
    const setOrClear = (name, v) => (v === null ? view.renderer?.removeAttribute?.(name) : view.renderer?.setAttribute?.(name, v));
    setOrClear('max-column-count', cols === null ? null : String(Math.round(cols)));
    setOrClear('gap', gapPct === null ? null : `${gapPct}%`);
    setOrClear('max-inline-size', inline === null ? null : `${Math.round(inline)}px`);
    const BLOCKS = 'body, body p, body li, body blockquote, body dd, body dt, body div';
    const typo = (lineHeight !== null ? `${BLOCKS} { line-height: ${lineHeight} !important; } ` : '')
      + (s.justify === true ? `${BLOCKS} { text-align: justify !important; } ` : s.justify === false ? `${BLOCKS} { text-align: start !important; } ` : '')
      + (s.hyphenate === true ? 'html, body, body * { hyphens: auto !important; -webkit-hyphens: auto !important; } ' : s.hyphenate === false ? 'html, body, body * { hyphens: manual !important; -webkit-hyphens: manual !important; } ' : '');
    const t = THEMES[theme] ?? THEMES.light;
    const pct = Number.isFinite(fontPct) ? Math.min(250, Math.max(60, fontPct)) : 100;
    document.documentElement.style.background = t.bg;
    view.renderer?.setAttribute?.('flow', flow === 'scrolled' ? 'scrolled' : 'paginated');
    const stack = FONTS[font];
    const face = stack ? `html, body, body :not(pre):not(code):not(kbd):not(samp) { font-family: ${stack} !important; }` : '';
    view.renderer?.setStyles?.(`${faceCss[font] ?? ''} ${typo}html { color: ${t.fg}; background: ${t.bg}; font-size: ${pct}% !important; } a { color: inherit; } ${face}`);
  };
  applyStyle({});
  const paint = async next => {
    for (const old of items) await view.deleteAnnotation({ value: old.cfi }).catch(() => {});
    items = next.slice(0, 2000).filter(i => typeof i?.cfi === 'string' && i.cfi && i.cfi.length <= 16384 && typeof i.id === 'string');
    byValue.clear();
    for (const i of items) {
      byValue.set(i.cfi, i.id);
      await view.addAnnotation({ value: i.cfi, kind: i.kind, color: safeColor(i.color), style: safeStyle(i.style) }).catch(() => {}); // an unresolved CFI is simply not painted
    }
  };
  session = {
    dispose: () => { searchToken++; clearTimeout(selTimer); fontUrls.forEach(u => URL.revokeObjectURL(u)); view.close?.(); view.remove(); },
    async goto(m) {
      if (typeof m.cfi === 'string') return void (await view.goTo(m.cfi));
      if (typeof m.href === 'string') return void (await view.goTo(m.href));
      if (Number.isFinite(m.fraction)) return void (await view.goToFraction(Math.min(1, Math.max(0, m.fraction))));
    },
    async nav(dir) { await (dir === 'prev' ? view.prev() : view.next()); },
    style: applyStyle,
    // A bundled font's files: declare the family from blob URLs, then apply the style again.
    fonts: m => {
      const family = FAMILY[m.id];
      if (!family || !Array.isArray(m.faces) || faceCss[m.id]) return;
      const css = [];
      for (const f of m.faces.slice(0, 8)) {
        if (!(f?.buffer instanceof ArrayBuffer) || f.buffer.byteLength > 400000) continue;
        const url = URL.createObjectURL(new Blob([f.buffer], { type: 'font/woff2' }));
        fontUrls.push(url);
        css.push('@font-face{font-family:"' + family + '";font-weight:' + (f.weight === 700 ? 700 : 400) + ';font-style:' + (f.style === 'italic' ? 'italic' : 'normal') + ';src:url(' + url + ') format("woff2");}');
      }
      faceCss[m.id] = css.join('');
      applyStyle(lastStyle);
    },
    annotations: paint,
    // Where each annotation sits in the book (to the chapter it is in), for the timeline.
    locate: list => {
      const out = {};
      for (const i of list.slice(0, 2000)) {
        if (typeof i?.id !== 'string' || typeof i.cfi !== 'string' || !i.cfi || i.cfi.length > 16384) continue;
        try {
          const idx = view.resolveCFI(i.cfi)?.index;
          const a = starts[idx], b = starts[idx + 1];
          if (Number.isFinite(a)) out[i.id] = Math.min(1, Math.max(0, a + (Number.isFinite(b) ? (b - a) * 0.02 : 0)));
        } catch { /* unplaceable: no mark */ }
      }
      send({ t: 'located', generation, positions: out });
    },
    // In-book search (Foliate's own matcher). Hits stream per chapter; a newer search or a clear cancels the running one.
    async search(m) {
      const query = typeof m.query === 'string' ? m.query.trim().slice(0, 256) : '';
      const token = ++searchToken;
      view.clearSearch();
      if (!query) return send({ t: 'search-done', generation, total: 0, capped: false });
      let total = 0, capped = false;
      const cap = Math.round(clampNum(m.max, 1, MAX_SEARCH_HITS) ?? MAX_SEARCH_HITS);
      for await (const r of view.search({ query, matchCase: m.matchCase === true, wholeWords: m.wholeWords === true, matchDiacritics: m.matchDiacritics === true })) {
        if (token !== searchToken) return;
        if (r === 'done') break;
        if (typeof r.progress === 'number') { send({ t: 'search-progress', generation, progress: clampNum(r.progress, 0, 1) ?? 0 }); continue; }
        const items = (r.subitems ?? []).filter(x => typeof x?.cfi === 'string' && x.cfi.length <= 16384).slice(0, cap - total).map(x => ({
          cfi: x.cfi, pre: String(x.excerpt?.pre ?? '').slice(-80), match: String(x.excerpt?.match ?? '').slice(0, 200), post: String(x.excerpt?.post ?? '').slice(0, 80),
        }));
        total += items.length;
        if (items.length) send({ t: 'search-results', generation, label: String(r.label ?? '').slice(0, 256), items });
        if (total >= cap) { capped = true; break; }
      }
      if (token === searchToken) send({ t: 'search-done', generation, total, capped });
    },
    clearSearch: () => { searchToken++; view.clearSearch(); },
    clearSelection: () => { for (const c of view.renderer?.getContents?.() ?? []) c.doc?.getSelection?.()?.removeAllRanges(); },
  };
  const opened = view.book ?? book;
  send({ t: 'toc', generation, items: toc(opened.toc) });
  // Where each chapter starts, as a fraction of the whole book, for the timeline.
  const starts = view.getSectionFractions();
  const flat = (xs, d = 0) => (d > 6 || !Array.isArray(xs) ? [] : xs.flatMap(i => [i, ...flat(i.subitems, d + 1)]));
  const chapters = [];
  for (const i of flat(opened.toc).slice(0, 500)) {
    try {
      const at = typeof i.href === 'string' ? view.resolveNavigation(i.href) : null;
      const f = Number.isInteger(at?.index) ? starts[at.index] : undefined;
      if (Number.isFinite(f)) chapters.push({ label: String(i.label ?? '').slice(0, 256), fraction: Math.min(1, Math.max(0, f)) });
    } catch { /* an unresolved entry has no mark */ }
  }
  send({ t: 'chapters', generation, items: chapters });
  send({ t: 'loaded', generation, engine: 'foliate', sections: opened.sections?.length ?? 0, title: typeof opened.metadata?.title === 'string' ? opened.metadata.title : null });
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

// MOBI, AZW and AZW3 are read whole (bounded) and parsed by pristine Foliate's mobi.js.
async function openMobi(size, name, restore) {
  if (size > WHOLE_FILE_MAX) throw new LimitError('archive_limit');
  const bytes = await readRange(size, 0, size);
  await mountFoliate(new File([bytes], name || 'book.mobi'), restore);
}

const clamp01 = v => Math.min(1, Math.max(0, v));

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
  const stage = document.getElementById('stage');
  const wrap = document.createElement('div');
  wrap.id = 'pdfwrap';
  wrap.style.cssText = 'position:relative;width:fit-content;margin:0 auto';
  const canvas = document.createElement('canvas');
  canvas.id = 'pdf';
  canvas.style.cssText = 'display:block;max-width:none;touch-action:pan-x pan-y';
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none';
  // Text layer (selectable, invisible text) between the page image and the highlight overlay.
  const textDiv = document.createElement('div');
  textDiv.className = 'textLayer';
  if (!document.getElementById('pdf-text-css')) {
    const css = document.createElement('style');
    css.id = 'pdf-text-css';
    css.textContent = '.textLayer{position:absolute;inset:0;overflow:clip;line-height:1;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;z-index:1}' +
      '.textLayer :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%}' +
      '.textLayer ::selection{background:rgba(34,139,230,.35)}';
    document.head.append(css);
  }
  wrap.append(canvas, textDiv, layer);
  stage.append(wrap);

  let page = null, viewport = null, current = -1, busy = null, mode = 'off', rubber = null;
  let style = { fontPct: 100, theme: 'light' };
  let items = [];

  // Coordinates: fractions of the UNROTATED crop box, measured from its top-left (contracts/t005/README.md).
  // pdf.js maps between viewport pixels (rotation and crop applied) and PDF user space.
  const box = () => { const [x0, y0, x1, y1] = page.view; return { x0, y0, w: x1 - x0, h: y1 - y0 }; };
  const toFraction = (vx, vy) => {
    const [x, y] = viewport.convertToPdfPoint(vx, vy);
    const b = box();
    return { x: clamp01((x - b.x0) / b.w), y: clamp01((b.y0 + b.h - y) / b.h) };
  };
  const toViewport = (fx, fy) => {
    const b = box();
    return viewport.convertToViewportPoint(b.x0 + fx * b.w, b.y0 + b.h - fy * b.h);
  };

  const paint = () => {
    layer.replaceChildren();
    if (!page) return;
    for (const it of items) {
      if (it.pdf.pageIndex !== current) continue;
      for (const r of it.pdf.rectangles) {
        const [ax, ay] = toViewport(r.x, r.y);
        const [bx, by] = toViewport(r.x + r.width, r.y + r.height);
        const d = document.createElement('div');
        d.dataset.annotation = it.id;
        d.style.cssText = `position:absolute;left:${Math.min(ax, bx)}px;top:${Math.min(ay, by)}px;width:${Math.abs(bx - ax)}px;height:${Math.abs(by - ay)}px;` +
          `background:${safeColor(it.color) ? `${safeColor(it.color)}66` : it.kind === 'note' ? 'rgba(126,200,255,.4)' : 'rgba(255,213,74,.4)'};pointer-events:auto;cursor:pointer`;
        d.addEventListener('click', () => {
          const b = d.getBoundingClientRect(), n = v => (Number.isFinite(v) ? Math.round(v) : 0);
          send({ t: 'annotation-click', generation, id: it.id, rect: { x: n(b.left), y: n(b.top), width: n(b.width), height: n(b.height) } });
        });
        layer.append(d);
      }
    }
  };

  const report = () => {
    if (!viewport) return;
    const vx = Math.max(0, stage.scrollLeft - wrap.offsetLeft);
    const vy = Math.max(0, stage.scrollTop - wrap.offsetTop);
    const f = toFraction(Math.min(vx, viewport.width), Math.min(vy, viewport.height));
    send({ t: 'relocate', generation, pageIndex: current, numPages: doc.numPages, x: f.x, y: f.y, cfi: null,
      fraction: doc.numPages > 1 ? current / (doc.numPages - 1) : 1, tocLabel: null });
  };
  let scrollTimer = 0;
  stage.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(report, 300); });

  const show = async (index, at) => {
    const i = Math.min(doc.numPages - 1, Math.max(0, index));
    page = await doc.getPage(i + 1);
    current = i;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(0.5, (style.fontPct / 100) * (Math.min(stage.clientWidth || base.width, 1400) / base.width)));
    viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    textDiv.replaceChildren();
    textDiv.style.setProperty('--scale-factor', String(viewport.scale));
    textDiv.style.setProperty('--total-scale-factor', String(viewport.scale));
    textDiv.style.setProperty('--scale-round-x', '1px');
    textDiv.style.setProperty('--scale-round-y', '1px');
    textDiv.style.width = canvas.width + 'px';
    textDiv.style.height = canvas.height + 'px';
    try { await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport }).render(); }
    catch { /* a page without usable text stays selectable by area only */ }
    paint();
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      const [vx, vy] = toViewport(clamp01(at.x), clamp01(at.y));
      stage.scrollLeft = wrap.offsetLeft + vx;
      stage.scrollTop = wrap.offsetTop + vy;
    } else { stage.scrollTop = 0; stage.scrollLeft = 0; }
    report();
  };
  let tail = Promise.resolve();
  const queue = fn => (tail = tail.then(fn).catch(err => fail('render_failed', String(err?.message ?? err))));

  // Area highlight: drag a rectangle; it is reported as unrotated crop-box fractions.
  let start = null;
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'area' || e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    start = local(e);
    rubber?.remove();
    rubber = document.createElement('div');
    rubber.style.cssText = 'position:absolute;border:2px dashed #228be6;background:rgba(34,139,230,.2);pointer-events:none';
    layer.append(rubber);
  });
  canvas.addEventListener('pointermove', e => {
    if (!start || !rubber) return;
    const [x, y] = local(e);
    rubber.style.left = `${Math.min(start[0], x)}px`; rubber.style.top = `${Math.min(start[1], y)}px`;
    rubber.style.width = `${Math.abs(x - start[0])}px`; rubber.style.height = `${Math.abs(y - start[1])}px`;
  });
  // A tap on the page (not a drag, not a text selection) while area mode is off.
  wrap.addEventListener('click', e => {
    if (mode === 'area' || e.button > 0 || document.getSelection()?.isCollapsed === false || e.target?.closest?.('[data-annotation]')) return;
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    send({ t: 'tap', generation, x: clampNum(e.clientX / w, 0, 1) ?? 0, y: clampNum(e.clientY / h, 0, 1) ?? 0 });
  });
  canvas.addEventListener('pointerup', e => {
    if (!start) return;
    const [x, y] = local(e);
    const s0 = start;
    start = null;
    if (Math.abs(x - s0[0]) < 4 || Math.abs(y - s0[1]) < 4) { rubber?.remove(); rubber = null; return send({ t: 'selection', generation, cleared: true }); }
    const a = toFraction(Math.min(s0[0], x), Math.min(s0[1], y));
    const b = toFraction(Math.max(s0[0], x), Math.max(s0[1], y));
    // Corners map to opposite crop-box corners under rotation, so normalize.
    const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(Math.abs(b.x - a.x), 1e-6), height: Math.max(Math.abs(b.y - a.y), 1e-6) };
    send({ t: 'selection', generation, text: '', pdf: { pageIndex: current, rectangles: [rect] } });
  });

  // Text selection: report the selected text and its line rectangles as crop-box fractions.
  let selTimer = 0;
  const onSelection = () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = document.getSelection();
      if (!viewport || !sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!textDiv.contains(range.commonAncestorContainer)) return;
      const text = sel.toString();
      if (!text.trim()) return;
      const cb = canvas.getBoundingClientRect();
      const rectangles = [];
      for (const r of range.getClientRects()) {
        if (r.width < 2 || r.height < 2) continue;
        const a = toFraction(r.left - cb.left, r.top - cb.top);
        const b = toFraction(r.right - cb.left, r.bottom - cb.top);
        const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        if (w <= 0 || h <= 0) continue;
        rectangles.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: w, height: h });
        if (rectangles.length >= 256) break;
      }
      if (!rectangles.length) return;
      send({ t: 'selection', generation, text: text.slice(0, 16384), pdf: { pageIndex: current, rectangles }, rect: rectOf(range, null) });
    }, 200);
  };
  document.addEventListener('selectionchange', onSelection);

  let restored = true;
  const want = Number.isSafeInteger(restore.pageIndex) ? restore.pageIndex : 0;
  if (want >= doc.numPages) restored = false;
  await show(restored ? want : 0, restored ? { x: restore.x, y: restore.y } : null);
  if (!restored) send({ t: 'restore-failed', generation });
  session = {
    dispose: () => { clearTimeout(scrollTimer); clearTimeout(selTimer); document.removeEventListener('selectionchange', onSelection); task.destroy(); wrap.remove(); },
    goto: m => queue(() => show(Number.isSafeInteger(m.pageIndex) ? m.pageIndex : 0, { x: m.x, y: m.y })),
    nav: dir => queue(() => show(current + (dir === 'prev' ? -1 : 1))),
    style: m => {
      style = { fontPct: Number.isFinite(m.fontPct) ? m.fontPct : 100, theme: m.theme };
      document.documentElement.style.background = THEMES[m.theme]?.bg ?? '#fff';
      return queue(() => { const f = viewport ? toFraction(Math.max(0, stage.scrollLeft - wrap.offsetLeft), Math.max(0, stage.scrollTop - wrap.offsetTop)) : null; return show(current, f); });
    },
    annotations: next => {
      items = next.slice(0, 2000).filter(i => typeof i?.id === 'string' && i.pdf && Number.isSafeInteger(i.pdf.pageIndex) && Array.isArray(i.pdf.rectangles)
        && i.pdf.rectangles.length <= 256 && i.pdf.rectangles.every(r => [r.x, r.y, r.width, r.height].every(Number.isFinite)));
      paint();
    },
    clearSelection: () => { rubber?.remove(); rubber = null; document.getSelection()?.removeAllRanges(); },
    search: () => send({ t: 'search-done', generation, total: 0, capped: false, unsupported: true }),
    clearSearch: () => {},
    pdfMode: m => { mode = m; textDiv.style.pointerEvents = m === 'area' ? 'none' : 'auto'; canvas.style.cursor = m === 'area' ? 'crosshair' : 'default'; canvas.style.touchAction = m === 'area' ? 'none' : 'pan-x pan-y'; },
  };
  send({ t: 'toc', generation, items: [] });
  send({ t: 'loaded', generation, engine: 'pdfjs', pages: doc.numPages });
}
