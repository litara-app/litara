import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const APP = "http://127.0.0.1:8099";
const READER = "http://localhost:8098";
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
    const buf = await fs.readFile(fx(name));
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
  page.waitForFunction((t) => (window as any).__proofEvents?.some((e: Ev) => e.t === t), t, { timeout: 15_000 });
const readerFrame = (page: Page) => page.frames().find((f) => f.url().startsWith(`${READER}/frame.html`))!;
// Records external requests that actually completed. Blocked attempts
// (CSP) surface as failed requests and are tracked separately.
const externalRequests = (page: Page) => {
  const done: string[] = [];
  const isExternal = (url: string) => {
    const u = new URL(url);
    return u.protocol.startsWith("http") && u.origin !== APP && u.origin !== READER;
  };
  page.on("requestfinished", (r) => { if (isExternal(r.url())) done.push(r.url()); });
  page.on("response", (r) => { if (isExternal(r.url())) done.push(r.url()); });
  return done;
};

test("origins, CSP and routing are separated", async ({ request }) => {
  const res = await request.get(`${READER}/frame.html`);
  const csp = res.headers()["content-security-policy"];
  expect(csp).toContain("sandbox allow-scripts allow-same-origin");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain(`frame-ancestors ${APP} ${READER}`);
  expect(csp).not.toMatch(/unsafe-eval|https:|\*/);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
  for (const p of ["/api/v1/me", "/library", "/healthz", "/index.html"]) {
    expect((await request.get(`${READER}${p}`)).status()).toBe(404);
  }
  expect((await request.get(`${APP}/reader/frame.html`)).status()).toBe(404);
  const spa = await request.get(`${APP}/library`);
  expect(spa.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(spa.headers()["content-security-policy"]).toContain(`frame-src ${READER}`);
  expect((await request.get(`${APP}/api/v1/nothing`)).status()).toBe(404);
});

test("EPUB renders in the reader origin and cannot reach the app", async ({ page, context }) => {
  const external = externalRequests(page);
  await context.addCookies([{ name: "litara_session", value: "SECRET", url: APP }]);
  await open(page, "synthetic.epub");
  await page.evaluate(() => localStorage.setItem("app-secret", "SECRET"));
  await waitFor(page, "loaded");
  const frame = readerFrame(page);
  expect(frame).toBeTruthy();
  expect(await page.locator("iframe").getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  const probe = await frame.evaluate(async (app) => {
    const r: Record<string, string> = { origin: location.origin };
    const attempts: Record<string, () => unknown> = {
      cookie: () => document.cookie,
      parentDoc: () => (window.parent.document as any).title,
      appStorage: () => localStorage.getItem("app-secret"),
    };
    for (const [k, f] of Object.entries(attempts)) {
      try { r[k] = String(f()); } catch (e) { r[k] = "blocked:" + (e as Error).name; }
    }
    try { await fetch(app + "/api/v1/me", { credentials: "include" }); r.fetchApp = "allowed"; } catch { r.fetchApp = "blocked"; }
    return r;
  }, APP);
  expect(probe.origin).toBe(READER);
  expect(probe.cookie).not.toContain("SECRET");
  expect(probe.parentDoc).toMatch(/^blocked/);
  expect(probe.appStorage).toBe("null");
  expect(probe.fetchApp).toBe("blocked");
  const text = await frame.evaluate(() => {
    const v: any = document.querySelector("foliate-view");
    return v.renderer.getContents().map((c: any) => c.doc.body.textContent).join(" ");
  });
  expect(text).toContain("Synthetic Litara fixture");
  expect(((await events(page)).find((e) => e.t === "loaded") as Ev).engine).toBe("foliate");
  expect(external).toEqual([]);
});

test("hostile EPUB script and external image do not run or fetch", async ({ page }) => {
  const external = externalRequests(page);
  await open(page, "hostile-script.epub");
  await waitFor(page, "loaded");
  await page.waitForTimeout(1500);
  const frame = readerFrame(page);
  const executed = await frame.evaluate(() => {
    const v: any = document.querySelector("foliate-view");
    return v.renderer.getContents().map((c: any) => c.doc.body.dataset.executed ?? null);
  });
  expect(executed.every((x: unknown) => x === null)).toBe(true);
  const msgs = await page.evaluate(() => (window as any).__hostile as any[]);
  expect(msgs.filter((m) => m?.type === "hostile-book-script")).toEqual([]);
  expect(external).toEqual([]);
});

for (const [file, label] of [["numeric-pages.cbz", "CBZ"], ["synthetic.fb2", "FB2"]] as const) {
  test(`${label} opens through pristine Foliate`, async ({ page }) => {
    await open(page, file);
    await waitFor(page, "loaded");
    expect(((await events(page)).find((e) => e.t === "loaded") as Ev).engine).toBe("foliate");
  });
}

test("PDF renders through direct PDF.js", async ({ page }) => {
  await open(page, "cropped-rotated.pdf");
  await waitFor(page, "loaded");
  expect((await events(page)).find((e) => e.t === "loaded")).toMatchObject({ engine: "pdfjs", pages: 2 });
  const painted = await readerFrame(page).evaluate(() => {
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
    h.onMessage({ t: "range", generation: g, id: 1, start: 0, end: 1e9 }); // beyond file and 8 MiB
    h.onMessage({ t: "range", generation: g, id: 1, start: -5, end: 3 });
    h.onMessage({ t: "fetch", generation: g }); // not in the allowlist
    h.onMessage({ t: "asset", generation: g, id: 2, name: "x" }); // asset channel removed
    h.onMessage("not an object");
    return h.rejected - before;
  });
  expect(rejected).toBe(6);
});

test("frame ignores a hello that does not match its configured parent origin", async ({ page }) => {
  await open(page, "cropped-rotated.pdf");
  await waitFor(page, "loaded");
  const ready = await page.evaluate(async (reader) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-same-origin");
    f.src = `${reader}/frame.html?parent=${encodeURIComponent("https://evil.example")}`;
    document.body.append(f);
    await new Promise((r) => (f.onload = r));
    const { port1, port2 } = new MessageChannel();
    const got = new Promise<boolean>((res) => { port1.onmessage = () => res(true); setTimeout(() => res(false), 1500); });
    f.contentWindow!.postMessage({ type: "litara.reader.hello", channel: "x", generation: 99 }, reader, [port2]);
    return got;
  }, READER);
  expect(ready).toBe(false);
});
