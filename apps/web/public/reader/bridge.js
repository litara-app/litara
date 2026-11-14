// Litara-owned reader bridge (MIT). It runs inside the opaque-origin sandbox
// and has no credentials or network privileges. All bytes arrive over a
// per-open MessageChannel from the authenticated parent (ADR-0067).
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
// opaque origin string proves nothing; source identity and the per-open
// nonce/generation checked by the parent are the authentication.
window.addEventListener('message', function onHello(event) {
  if (port || event.source !== window.parent) return;
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
  if (!Number.isSafeInteger(size) || size <= 0 || typeof kind !== 'string') {
    throw Object.assign(new Error('bad open'), { code: 'bad_open' });
  }
  const limits = lowerLimits(m.limits);
  if (kind === 'epub' || kind === 'cbz') return openZip(kind, size, String(name ?? ''), limits);
  if (kind === 'fb2') return openWhole(size, String(name ?? ''));
  if (kind === 'pdf') return openPdf(size);
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

async function mountFoliate(book) {
  await import('./vendor/foliate-js/view.js');
  const view = document.createElement('foliate-view');
  document.getElementById('stage').append(view);
  // Embedded links must never navigate; report them to the parent instead.
  view.addEventListener('external-link', e => { e.preventDefault(); send({ t: 'blocked-link', generation }); });
  view.addEventListener('relocate', e => {
    const { cfi, fraction, location } = e.detail ?? {};
    send({ t: 'relocate', generation, cfi: typeof cfi === 'string' ? cfi.slice(0, 2048) : null, fraction: Number.isFinite(fraction) ? fraction : null, page: location?.current ?? null });
  });
  await view.open(book);
  await view.init({ showTextStart: true });
  session = { dispose: () => { view.close?.(); view.remove(); } };
  send({ t: 'loaded', generation, engine: 'foliate', sections: book.sections?.length ?? 0, title: typeof book.metadata?.title === 'string' ? book.metadata.title : null });
}

async function openZip(kind, size, name, limits) {
  const loader = await makeBoundedZipLoader(size, limits);
  let book;
  if (kind === 'cbz') {
    const { makeComicBook } = await import('./vendor/foliate-js/comic-book.js');
    book = makeComicBook(loader, { name: name || 'book.cbz' });
  } else {
    const { EPUB } = await import('./vendor/foliate-js/epub.js');
    book = await new EPUB(loader).init();
  }
  await mountFoliate(book);
}

async function openWhole(size, name) {
  if (size > WHOLE_FILE_MAX) throw new LimitError('archive_limit');
  const bytes = await readRange(size, 0, size);
  const { makeFB2 } = await import('./vendor/foliate-js/fb2.js');
  await mountFoliate(await makeFB2(new File([bytes], name || 'book.fb2')));
}

async function openPdf(size) {
  const pdfjs = await import('./vendor/pdfjs/pdf.mjs');
  // An opaque-origin document cannot start a module worker (neither from a
  // blob: URL nor cross-origin; observed in Chromium) and the PDF worker needs
  // import.meta, so it cannot run as a classic blob worker either. PDF.js
  // therefore uses its main-thread "fake worker", imported as a CORS module
  // from the pinned static path. Parsing shares the sandbox frame's thread.
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
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement('canvas');
  canvas.id = 'pdf';
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  document.getElementById('stage').append(canvas);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  session = { dispose: () => { task.destroy(); canvas.remove(); } };
  send({ t: 'loaded', generation, engine: 'pdfjs', pages: doc.numPages });
}
