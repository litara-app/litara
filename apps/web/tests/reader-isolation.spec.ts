import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const fx = (name: string) => path.resolve(import.meta.dirname, "../../../.tmp/t005-fixtures", name);

type Ev = { t: string; [k: string]: unknown };

async function open(page: Page, name: string, limits?: Record<string, number>) {
  await page.goto("/read/proof");
  await page.evaluate(() => {
    (window as any).__hostile = [];
    window.addEventListener("message", (e) => (window as any).__hostile.push(e.data));
  });
  await page.waitForFunction(() => typeof (window as any).__proofOpen === "function");
  if (limits) {
    const buf = await (await import("node:fs/promises")).readFile(fx(name));
    await page.evaluate(
      ([b64, n, l, k]) => {
        const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
        return (window as any).__proofOpen(new File([bytes], n as string), k, l);
      },
      [buf.toString("base64"), name, limits, name.split(".").pop()] as const,
    );
  } else {
    await page.setInputFiles("#file", fx(name));
  }
}

const events = (page: Page) => page.evaluate(() => (window as any).__proofEvents as Ev[]);
const waitFor = (page: Page, t: string) =>
  page.waitForFunction((t) => (window as any).__proofEvents?.some((e: Ev) => e.t === t), t, { timeout: 10_000 });

test("reader document carries the production CSP and anonymous CORS", async ({ request }) => {
  const res = await request.get("/reader/frame.html");
  const csp = res.headers()["content-security-policy"];
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toMatch(/unsafe-eval|https?:|\*/);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(res.headers()["access-control-allow-origin"]).toBe("*");
  expect(res.headers()["access-control-allow-credentials"]).toBeUndefined();
  const spa = await request.get("/library");
  expect(spa.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect((await request.get("/api/v1/nothing")).status()).toBe(404);
});

// BLOCKER (ADR-0067): pristine Foliate reads each section frame's
// contentDocument, which is null for every child of an opaque-origin sandbox
// (nested sandboxes inherit the missing allow-same-origin). These tests are
// expected to fail until the owner decides how to proceed; see handoffs/T005.md.
test.describe("Foliate in the opaque sandbox (known blocker)", () => {
test.fail(true, "pristine Foliate cannot render sections in an opaque-origin sandbox");
test("EPUB opens in the opaque sandbox and cannot reach the app", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http") && u.origin !== "http://127.0.0.1:8099") external.push(r.url());
  });
  await open(page, "synthetic.epub");
  await waitFor(page, "loaded");
  const frame = page.frames().find((f) => f.url().endsWith("/reader/frame.html"))!;
  expect(frame).toBeTruthy();
  const sandbox = await page.locator("iframe").getAttribute("sandbox");
  expect(sandbox).toBe("allow-scripts");
  const probe = await frame.evaluate(() => {
    const r: Record<string, string> = { origin: location.origin };
    for (const [k, f] of Object.entries({
      cookie: () => document.cookie,
      parentDoc: () => (window.parent.document as any).title,
      storage: () => localStorage.length,
    })) {
      try { r[k] = String(f()); } catch (e) { r[k] = "blocked:" + (e as Error).name; }
    }
    return r;
  });
  expect(probe.origin).toBe("null");
  expect(probe.cookie).toMatch(/^blocked/);
  expect(probe.parentDoc).toMatch(/^blocked/);
  expect(probe.storage).toMatch(/^blocked/);
  const evs = await events(page);
  expect(evs.find((e) => e.t === "loaded")).toMatchObject({ engine: "foliate" });
  expect(external).toEqual([]);
});

test("hostile EPUB script and external image do not run or fetch", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http") && u.origin !== "http://127.0.0.1:8099") external.push(r.url());
  });
  await open(page, "hostile-script.epub");
  await waitFor(page, "loaded");
  await page.waitForTimeout(1500);
  const msgs = await page.evaluate(() => (window as any).__hostile as any[]);
  expect(msgs.filter((m) => m?.type === "hostile-book-script")).toEqual([]);
  expect(external).toEqual([]);
});

test("CBZ opens through Foliate", async ({ page }) => {
  await open(page, "numeric-pages.cbz");
  await waitFor(page, "loaded");
  expect(((await events(page)).find((e) => e.t === "loaded") as Ev).engine).toBe("foliate");
});
});

test("PDF renders through direct PDF.js", async ({ page }) => {
  await open(page, "cropped-rotated.pdf");
  await waitFor(page, "loaded");
  const loaded = (await events(page)).find((e) => e.t === "loaded") as Ev;
  expect(loaded).toMatchObject({ engine: "pdfjs", pages: 2 });
  const frame = page.frames().find((f) => f.url().endsWith("/reader/frame.html"))!;
  const painted = await frame.evaluate(() => {
    const c = document.getElementById("pdf") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) return true;
    return false;
  });
  expect(painted).toBe(true);
});

test("archive ceilings reject before display", async ({ page }) => {
  await open(page, "synthetic.epub", { entries: 1 });
  await waitFor(page, "error");
  expect(((await events(page)).find((e) => e.t === "error") as Ev).code).toBe("archive_limit");
});

test("parent drops forged or out-of-bounds bridge messages", async ({ page }) => {
  await open(page, "cropped-rotated.pdf");
  await waitFor(page, "loaded");
  const rejected = await page.evaluate(() => {
    const h = (window as any).__proofHost;
    const g = h.generation;
    const before = h.rejected;
    h.onMessage({ t: "range", generation: g + 1, id: 1, start: 0, end: 10 }); // stale generation
    h.onMessage({ t: "range", generation: g, id: 1, start: 0, end: 1e9 }); // over file/8 MiB
    h.onMessage({ t: "range", generation: g, id: 1, start: -5, end: 3 });
    h.onMessage({ t: "fetch", generation: g }); // not in the allowlist
    h.onMessage({ t: "asset", generation: g, id: 2, name: "../../api/v1/me" }); // asset requests no longer exist
    h.onMessage("not an object");
    return h.rejected - before;
  });
  expect(rejected).toBe(6);
});
