// Parent side of the credential-free reader bridge (ADR-0067). The parent
// performs every authorized read; the sandboxed frame only sees bytes it asked
// for on a per-open MessageChannel.

export const MAX_RANGE = 8 * 1024 * 1024;
export const MAX_OUTSTANDING = 2;

export type ReaderKind = "epub" | "cbz" | "fb2" | "pdf";

/** Byte source for the exact file/version being opened. */
export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<ArrayBuffer>;
}

export interface ReaderEvent {
  t: string;
  [key: string]: unknown;
}

export interface OpenOptions {
  kind: ReaderKind;
  name?: string;
  /** Lower-only resource ceilings (see ADR-0067). */
  limits?: Record<string, number>;
  /** Saved location to restore; an unresolved one is reported as restore-failed. */
  restore?: { cfi?: string; pageIndex?: number };
}

export type ReaderTheme = "light" | "sepia" | "dark";
export interface ReaderStyle { fontPct: number; theme: ReaderTheme; flow: "paginated" | "scrolled" }
export interface PaintedAnnotation { id: string; cfi: string; kind: "highlight" | "note" }

const INBOUND = new Set(["ready", "range", "loaded", "relocate", "blocked-link", "error", "toc", "selection", "annotation-click", "restore-failed", "key"]);

let generationCounter = 0;

export class ReaderHost {
  readonly generation = ++generationCounter;
  private readonly channel = crypto.randomUUID();
  private readonly frame: HTMLIFrameElement;
  private port: MessagePort | null = null;
  private outstanding = 0;
  private disposed = false;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  /** Counts messages dropped as invalid, for tests and diagnostics. */
  rejected = 0;

  constructor(
    container: HTMLElement,
    private readonly source: ByteSource,
    private readonly onEvent: (e: ReaderEvent) => void,
    private readonly readerOrigin: string,
  ) {
    this.ready = new Promise((r) => (this.resolveReady = r));
    const frame = document.createElement("iframe");
    // allow-same-origin applies to the reader origin only (ADR-0071), which
    // has no credentials; still no forms, popups, downloads or top navigation.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", "Book reader");
    frame.style.cssText = "border:0;width:100%;height:100%";
    frame.addEventListener("load", () => this.handshake(), { once: true });
    frame.src = `${readerOrigin}/frame.html?parent=${encodeURIComponent(location.origin)}`;
    container.append(frame);
    this.frame = frame;
  }

  private handshake() {
    const win = this.frame.contentWindow;
    if (!win || this.disposed) return;
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (e) => this.onMessage(e.data);
    this.port = port1;
    // Exact target origin: the reader origin only. The message carries just a
    // one-time channel id and generation.
    win.postMessage({ type: "litara.reader.hello", channel: this.channel, generation: this.generation }, this.readerOrigin, [port2]);
  }

  async open(opts: OpenOptions): Promise<void> {
    await this.ready;
    this.post({ t: "open", kind: opts.kind, name: opts.name, size: this.source.size, limits: opts.limits, restore: opts.restore });
  }

  goto(target: { cfi?: string; href?: string; fraction?: number; pageIndex?: number }) { this.post({ t: "goto", ...target }); }
  nav(dir: "next" | "prev") { this.post({ t: "nav", dir }); }
  setStyle(style: ReaderStyle) { this.post({ t: "style", ...style }); }
  setAnnotations(items: PaintedAnnotation[]) { this.post({ t: "annotations", items }); }
  clearSelection() { this.post({ t: "clear-selection" }); }

  private post(msg: Record<string, unknown>, transfer: Transferable[] = []) {
    if (!this.disposed) this.port?.postMessage({ ...msg, generation: this.generation }, transfer);
  }

  private onMessage(m: unknown) {
    if (this.disposed || !m || typeof m !== "object") return this.reject();
    const msg = m as ReaderEvent;
    if (typeof msg.t !== "string" || !INBOUND.has(msg.t) || msg.generation !== this.generation) return this.reject();
    switch (msg.t) {
      case "ready":
        if (msg.channel !== this.channel) return this.reject();
        this.resolveReady();
        return;
      case "range":
        return void this.serveRange(msg);
      default:
        this.onEvent(msg);
    }
  }

  private reject() {
    this.rejected++;
  }

  private async serveRange(msg: ReaderEvent) {
    const { id, start, end } = msg;
    const size = this.source.size;
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return this.reject();
    const s = start as number;
    const e = end as number;
    if (s < 0 || e <= s || e > size || e - s > MAX_RANGE || this.outstanding >= MAX_OUTSTANDING) {
      this.reject();
      this.post({ t: "range-error", id, code: "range_bounds" });
      return;
    }
    this.outstanding++;
    try {
      const buffer = await this.source.read(s, e);
      if (buffer.byteLength !== e - s) throw new Error("short read");
      this.post({ t: "range-data", id, buffer }, [buffer]);
    } catch {
      this.post({ t: "range-error", id, code: "read_failed" });
    } finally {
      this.outstanding--;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.post({ t: "close" });
    this.disposed = true;
    this.port?.close();
    this.frame.remove();
  }
}

/** Reads the reader origin the server advertises (ADR-0071). */
export async function loadReaderOrigin(): Promise<string> {
  const res = await fetch("/app-config.json", { credentials: "same-origin" });
  const { readerOrigin } = (await res.json()) as { readerOrigin?: string };
  if (!readerOrigin || new URL(readerOrigin).origin === location.origin) throw new Error("reader origin misconfigured");
  return new URL(readerOrigin).origin;
}

/** Range source over a user-picked File (used by tests and the proof page). */
export function fileSource(file: Blob): ByteSource {
  return { size: file.size, read: (s, e) => file.slice(s, e).arrayBuffer() };
}
