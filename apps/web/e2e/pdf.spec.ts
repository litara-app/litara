import { expect, test, type Frame, type Page } from "@playwright/test";

// pdf-coordinates: a cropped (CropBox [100 100 500 600]) and rotated (90) PDF page with one known
// filled rectangle. Its unrotated crop-box fractions are x=.25 y=.40 w=.25 h=.20 (ADR-0065 locator).

const PASSWORD = "synthetic-fixture-password";
const EXPECT = { x: 0.25, y: 0.4, width: 0.25, height: 0.2 };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill("fixture-user-a");
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeAttached(); // the account name is hidden at phone width
}

async function cropEditionId(page: Page): Promise<string> {
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const t = titles.find((x) => /^corpus-pdf-crop$/i.test(x.title));
  if (!t) throw new Error("corpus-pdf-crop missing; run with LITARA_E2E_CORPUS (scripts/web/e2e.sh)");
  return ((await (await page.request.get(`/api/v1/editions?titleId=${t.id}`)).json()).items as { id: string }[])[0].id;
}

const readerFrame = (page: Page): Frame | undefined => page.frames().find((f) => f.url().includes("/frame.html"));

/** Bounding box of the dark rectangle on the drawn canvas, in CSS pixels relative to the canvas. */
async function blackBox(f: Frame) {
  return f.evaluate(() => {
    const c = document.querySelector("#pdf") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] > 200 && d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, cw: c.width, ch: c.height };
  });
}

async function overlayBox(f: Frame, canvasBox: { x: number; y: number }) {
  let r: { x: number; y: number; width: number; height: number } | null = null;
  for (let i = 0; i < 20 && !r; i++) { // the layer is rebuilt on each repaint, so retry across one
    r = await f.locator("[data-annotation]").first().boundingBox({ timeout: 1000 }).catch(() => null);
    if (!r) await new Promise((x) => setTimeout(x, 250));
  }
  if (!r) throw new Error("no overlay painted");
  return { x: r.x - canvasBox.x, y: r.y - canvasBox.y, w: r.width, h: r.height };
}

test("rotated cropped PDF: area highlight maps to crop-box fractions and stays on the content across zoom", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const id = await cropEditionId(page);
  // The three browsers share one server: start from no annotations so an earlier run's overlay cannot intercept the drag.
  const csrf = ((await (await page.request.get("/api/v1/auth/web/session")).json()) as { csrfToken: string }).csrfToken;
  const existing = (await (await page.request.get(`/api/v1/editions/${id}/annotations?includeDeleted=false&size=100`)).json()).items as { id: string; revision: string }[];
  for (const x of existing) {
    const r = await page.request.delete(`/api/v1/editions/${id}/annotations/${x.id}`, {
      headers: { "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:8091" },
      data: { operationId: crypto.randomUUID(), baseRevision: x.revision, capturedAt: new Date().toISOString() },
    });
    expect(r.status(), await r.text()).toBeLessThan(300);
  }
  await page.goto(`/read/${id}`);
  await expect(page.getByTestId("progress")).toHaveText(/Page 1 of 1/, { timeout: 30_000 });
  await page.waitForTimeout(500);
  let f = readerFrame(page)!;

  // Rotate 90 of a 400x500 crop box shows a 500x400 page: landscape.
  const b0 = await blackBox(f);
  expect(b0.cw).toBeGreaterThan(b0.ch);
  expect(b0.w).toBeGreaterThan(5);

  // Draw the area tool exactly over the visible black rectangle.
  await page.getByTestId("area-tool").click();
  const cv = (await f.locator("#pdf").boundingBox())!;
  await page.mouse.move(cv.x + b0.x, cv.y + b0.y);
  await page.mouse.down();
  await page.mouse.move(cv.x + b0.x + b0.w / 2, cv.y + b0.y + b0.h / 2);
  await page.mouse.move(cv.x + b0.x + b0.w, cv.y + b0.y + b0.h);
  await page.mouse.up();
  await page.getByRole("button", { name: "Highlight", exact: true }).click();

  // The stored rectangle is in UNROTATED crop-box fractions, independent of the rotation and zoom shown.
  let saved: { x: number; y: number; width: number; height: number } | undefined;
  await expect.poll(async () => {
    const items = (await (await page.request.get(`/api/v1/editions/${id}/annotations?includeDeleted=false&size=50`)).json()).items as { data?: { selection?: { kind: string; rectangles: { x: number; y: number; width: number; height: number }[] } } }[];
    saved = items.find((a) => a.data?.selection?.kind === "pdf-rectangles")?.data?.selection?.rectangles[0];
    return !!saved;
  }, { timeout: 15_000 }).toBe(true);
  for (const k of ["x", "y", "width", "height"] as const) expect(saved![k], k).toBeCloseTo(EXPECT[k], 1);
  expect(Math.abs(saved!.x - EXPECT.x)).toBeLessThan(0.02);
  expect(Math.abs(saved!.y - EXPECT.y)).toBeLessThan(0.02);
  expect(Math.abs(saved!.width - EXPECT.width)).toBeLessThan(0.02);
  expect(Math.abs(saved!.height - EXPECT.height)).toBeLessThan(0.02);

  // Overlay and content must coincide at the default zoom and after zooming in (no drift).
  const check = async (label: string) => {
    f = readerFrame(page)!;
    await expect(f.locator("[data-annotation]").first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);
    const cvb = (await f.locator("#pdf").boundingBox())!;
    const b = await blackBox(f);
    const o = await overlayBox(f, cvb);
    for (const [k, got, want] of [["x", o.x, b.x], ["y", o.y, b.y], ["w", o.w, b.w], ["h", o.h, b.h]] as const) {
      expect(Math.abs(got - want), `${label} ${k}: overlay ${got} vs content ${want}`).toBeLessThanOrEqual(3);
    }
    return b;
  };
  const at100 = await check("100%");
  await page.getByRole("button", { name: "Text settings" }).click();
  const slider = page.getByRole("slider", { name: "Text size" });
  await slider.focus();
  for (let i = 0; i < 3; i++) await slider.press("ArrowLeft"); // 100% -> 70%
  await page.keyboard.press("Escape");
  const at70 = await check("70%");
  expect(at70.cw).toBeLessThan(at100.cw * 0.8);

  // A reloaded reader restores the saved page position through the same conversion.
  await page.reload();
  await expect(page.getByTestId("progress")).toHaveText(/Page 1 of 1/, { timeout: 30_000 });
  await page.waitForTimeout(800);
  f = readerFrame(page)!;
  await expect(f.locator("[data-annotation]")).toHaveCount(1);
});

test("PDF text can be selected, highlighted and painted back, and the quote is the selected text", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const t = titles.find((x) => /^corpus-pdf$/i.test(x.title));
  if (!t) throw new Error("corpus-pdf missing; run with LITARA_E2E_CORPUS (scripts/web/e2e.sh)");
  const id = ((await (await page.request.get(`/api/v1/editions?titleId=${t.id}`)).json()).items as { id: string }[])[0].id;
  const csrf = ((await (await page.request.get("/api/v1/auth/web/session")).json()) as { csrfToken: string }).csrfToken;
  const list = async () => (await (await page.request.get(`/api/v1/editions/${id}/annotations?includeDeleted=false&size=100`)).json()).items as { id: string; revision: string; data: { quote: string; kind: string; selection: { kind: string; rectangles: { x: number; y: number; width: number; height: number }[] } } }[];
  for (const x of await list()) {
    const r = await page.request.delete(`/api/v1/editions/${id}/annotations/${x.id}`, {
      headers: { "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:8091" },
      data: { operationId: crypto.randomUUID(), baseRevision: x.revision, capturedAt: new Date().toISOString() },
    });
    expect(r.status(), await r.text()).toBeLessThan(300);
  }
  await page.goto(`/read/${id}`);
  await expect(page.getByTestId("progress")).toHaveText(/Page 1 of 2/, { timeout: 30_000 });
  const f = readerFrame(page)!;
  const word = f.locator(".textLayer span").first();
  await expect(word).toBeVisible({ timeout: 15_000 });
  // The invisible text lies on the drawn text. Without PDF.js's sizing and rotation styles it did not, while highlights
  // still round-tripped, so only a comparison with the page's pixels shows it (ADR-0113).
  const line = (await word.boundingBox())!;
  const canvas = (await f.locator("#pdf").boundingBox())!;
  const ink = await f.evaluate(([top, bottom]) => {
    const c = document.querySelector("#pdf") as HTMLCanvasElement;
    const scale = c.width / c.getBoundingClientRect().width;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, x1 = -1;
    for (let y = Math.max(0, Math.floor(top * scale)); y < Math.min(c.height, Math.ceil(bottom * scale)); y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 300) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    }
    return { left: x0 / scale, right: (x1 + 1) / scale, width: c.width / scale };
  }, [line.y - canvas.y, line.y - canvas.y + line.height]);
  const near = ink.width * 0.025; // a glyph's side bearing
  expect(Math.abs(line.x - canvas.x - ink.left)).toBeLessThan(near);
  expect(Math.abs(line.x - canvas.x + line.width - ink.right)).toBeLessThan(near);
  await word.dblclick(); // selects one word of the page text
  await expect(page.getByTestId("selection-bar")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect.poll(async () => (await list()).length, { timeout: 15_000 }).toBe(1);
  const a = (await list())[0];
  expect(a.data.kind).toBe("highlight");
  expect(a.data.selection.kind).toBe("pdf-rectangles");
  expect(a.data.quote.trim().length).toBeGreaterThan(0);
  expect("Corpus PDF page 1").toContain(a.data.quote.trim());
  const r = a.data.selection.rectangles[0];
  expect(r.width).toBeGreaterThan(0.01);
  expect(r.x + r.width).toBeLessThanOrEqual(1.0001);
  // Painted over the selected text: the overlay box sits on the text box.
  await expect(f.locator("[data-annotation]").first()).toBeVisible({ timeout: 10_000 });
  const o = (await f.locator("[data-annotation]").first().boundingBox())!;
  const s = (await word.boundingBox())!;
  expect(o.x).toBeGreaterThanOrEqual(s.x - 3); // the selected word lies inside its text line
  expect(o.x + o.width).toBeLessThanOrEqual(s.x + s.width + 3);
  expect(Math.abs(o.y + o.height / 2 - (s.y + s.height / 2))).toBeLessThan(s.height); // same line
});
