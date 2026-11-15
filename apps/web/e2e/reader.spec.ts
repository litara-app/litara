import { expect, test, type Frame, type Page } from "@playwright/test";

const PASSWORD = "synthetic-fixture-password";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill("fixture-user-a");
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}

async function openBook(page: Page) {
  await page.goto("/");
  await page.getByText("The Browser Novel").click();
  await page.getByText(/EPUB/).first().click();
  await page.getByRole("link", { name: "Read" }).click();
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
}

const editionId = (page: Page) => page.url().split("/read/")[1];
// Section documents live in nested blob frames inside the sandboxed reader frame.
const sectionFrame = (page: Page): Frame | undefined => page.frames().find((f) => f.url().startsWith("blob:"));
// Foliate may also preload neighboring sections, so pick the one showing given text.
async function frameWith(page: Page, text: string): Promise<Frame> {
  for (let i = 0; i < 40; i++) {
    for (const f of page.frames().filter((x) => x.url().startsWith("blob:"))) {
      if ((await f.locator("body").innerText().catch(() => "")).includes(text)) return f;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`no section frame contains ${text}`);
}
const percent = async (page: Page) => Number((await page.getByTestId("progress").innerText()).replace("%", ""));

async function csrf(page: Page) {
  const s = await (await page.request.get("/api/v1/auth/web/session")).json();
  return s.csrfToken as string;
}

test.describe.configure({ mode: "serial" });

// Browser projects share one database, so each test starts from no annotations.
async function clearAnnotations(page: Page) {
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const novel = titles.find((t) => t.title === "The Browser Novel")!; // by title: the corpus adds other EPUBs
  const eds = await (await page.request.get(`/api/v1/editions?titleId=${novel.id}`)).json();
  const id = eds.items[0].id as string;
  const list = await (await page.request.get(`/api/v1/editions/${id}/annotations?includeDeleted=false&size=200`)).json();
  for (const a of list.items) {
    const res = await page.request.delete(`/api/v1/editions/${id}/annotations/${a.id}`, {
      headers: { "X-CSRF-Token": await csrf(page), Origin: "http://127.0.0.1:8091" },
      data: { operationId: crypto.randomUUID(), baseRevision: a.revision, capturedAt: new Date().toISOString() },
    });
    expect(res.status()).toBe(200);
  }
}

test("opens an EPUB, shows its text and contents, and navigates", async ({ page }) => {
  await signIn(page);
  await openBook(page);
  // Earlier runs (other browsers share the database) may have saved a position, so go to chapter one explicitly.
  await page.getByRole("button", { name: "Contents & notes" }).click();
  await page.getByRole("dialog").getByText("Chapter One", { exact: true }).first().click();
  await expect.poll(async () => (await sectionFrame(page)?.locator("body").innerText().catch(() => "")) ?? "", { timeout: 20_000 }).toContain("Chapter One");
  await page.getByRole("button", { name: "Contents & notes" }).click();
  await expect(page.getByRole("dialog").getByText("Chapter Three", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByText("Chapter Three", { exact: true }).first().click();
  await expect.poll(() => percent(page), { timeout: 15_000 }).toBeGreaterThan(50);
  await expect.poll(async () => (await sectionFrame(page)?.locator("body").innerText().catch(() => "")) ?? "").toContain("Chapter Three");
  await page.getByRole("button", { name: "Next page" }).click();
});

test("saves the position and resumes after a reload", async ({ page }) => {
  await signIn(page);
  await openBook(page);
  const saved = async () => (await (await page.request.get(`/api/v1/editions/${editionId(page)}/position`)).json());
  const first = (await saved()).position?.anchor.locator.cfi;
  await page.getByRole("button", { name: "Contents & notes" }).click();
  await page.getByRole("dialog").getByText("Chapter Two", { exact: true }).first().click();
  // Chapter two of three starts at about a third of the book, whatever place was open before.
  await expect.poll(() => percent(page), { timeout: 15_000 }).toBeLessThan(60);
  await expect.poll(() => percent(page), { timeout: 15_000 }).toBeGreaterThan(20);
  const before = await percent(page);
  await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 15_000 });
  await expect.poll(async () => (await saved()).position?.anchor.locator.cfi).not.toBe(first);

  const state = await saved();
  expect(Number(state.revision)).toBeGreaterThan(0);
  expect(state.position.anchor.locator.kind).toBe("foliate-cfi");

  await page.reload();
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  expect(Math.abs((await percent(page)) - before)).toBeLessThan(15); // resumed where it was saved, not at the start
});

test("bookmarks, highlights and notes persist and are listed", async ({ page }) => {
  await signIn(page);
  await clearAnnotations(page);
  await openBook(page);
  await expect.poll(async () => (await sectionFrame(page)?.locator("p").count()) ?? 0, { timeout: 20_000 }).toBeGreaterThan(3);

  await page.getByRole("button", { name: "Bookmark" }).click();

  // Select a real range inside the book text; the bridge reports it to the app.
  await (await frameWith(page, "Paragraph 1 of")).evaluate(() => {
    const p = document.querySelectorAll("p")[2];
    const r = document.createRange();
    r.setStart(p.firstChild!, 0);
    r.setEnd(p.firstChild!, 20);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  await expect(page.getByTestId("selection-bar")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Highlight" }).click();
  await expect(page.getByTestId("selection-bar")).toBeHidden();
  await page.waitForTimeout(700); // the clear-selection message reaches the frame asynchronously; a person cannot select faster

  await (await frameWith(page, "Paragraph 1 of")).evaluate(() => {
    const p = document.querySelectorAll("p")[4];
    const r = document.createRange();
    r.setStart(p.firstChild!, 0);
    r.setEnd(p.firstChild!, 15);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("textbox", { name: "Note" }).fill("Remember this fox");
  await page.getByRole("button", { name: "Save note" }).click();

  await page.getByRole("button", { name: "Contents & notes" }).click();
  await page.getByRole("tab", { name: /Notes/ }).click();
  await expect(page.getByTestId("annotation-item")).toHaveCount(3, { timeout: 10_000 });
  await expect(page.getByText("Remember this fox")).toBeVisible();

  const list = await (await page.request.get(`/api/v1/editions/${editionId(page)}/annotations?includeDeleted=false`)).json();
  const kinds = list.items.map((a: { data: { kind: string } }) => a.data.kind).sort();
  expect(kinds).toEqual(["bookmark", "highlight", "note"]);
  const hl = list.items.find((a: { data: { kind: string } }) => a.data.kind === "highlight");
  expect(hl.data.selection.kind).toBe("foliate-range");
  expect(hl.data.anchor.locator.cfi).toMatch(/^epubcfi\(/);

  // Delete leaves a tombstone: gone from the panel, hidden by default filter.
  await page.getByTestId("annotation-item").filter({ hasText: "bookmark" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("annotation-item")).toHaveCount(2, { timeout: 10_000 });
});

test("a stale position write is caught and the reader chooses", async ({ page }) => {
  await signIn(page);
  await openBook(page);
  await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 15_000 });
  const id = editionId(page);
  const cur = await (await page.request.get(`/api/v1/editions/${id}/position`)).json();

  // Another device writes first, so this tab's base revision is now stale.
  const put = await page.request.put(`/api/v1/editions/${id}/position`, {
    headers: { "X-CSRF-Token": await csrf(page), Origin: "http://127.0.0.1:8091" },
    data: { operationId: crypto.randomUUID(), baseRevision: cur.revision, capturedAt: new Date().toISOString(), anchor: cur.position.anchor },
  });
  expect(put.status()).toBe(200);

  await page.getByRole("button", { name: "Contents & notes" }).click();
  await page.getByRole("dialog").getByText("Chapter Three", { exact: true }).first().click();
  await expect(page.getByText("Your reading position changed elsewhere")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Keep my place" }).click();
  await expect(page.getByText("Your reading position changed elsewhere")).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 20_000 });
  const after = await (await page.request.get(`/api/v1/editions/${id}/position`)).json();
  expect(Number(after.revision)).toBeGreaterThan(Number(cur.revision) + 1);
});

test("a book request never carries the session cookie into the reader frame", async ({ page, context }) => {
  await signIn(page);
  const reader: string[] = [];
  page.on("request", (r) => { if (r.url().startsWith("http://localhost:8092")) reader.push(r.headers()["cookie"] ?? ""); });
  await openBook(page);
  expect(reader.length).toBeGreaterThan(0);
  expect(reader.every((c) => !c.includes("litara_session"))).toBe(true);
  expect((await context.cookies("http://localhost:8092")).length).toBe(0);
});

// cfi-reflow: a location saved at one text size and window shape resumes at the same text after a reload at a
// different size and shape (the saved CFI names text, not a page number).
test("a saved place resumes at the same text after the font size and window shape change", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await openBook(page);
  await page.getByRole("button", { name: "Contents & notes" }).click();
  await page.getByRole("dialog").getByText("Chapter Two", { exact: true }).first().click();
  await expect.poll(async () => (await sectionFrame(page)?.locator("body").innerText().catch(() => "")) ?? "", { timeout: 20_000 }).toContain("Chapter Two");
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 15_000 });
  const savedCfi = ((await (await page.request.get(`/api/v1/editions/${editionId(page)}/position`)).json()) as { position: { anchor: { locator: { cfi: string } } } }).position.anchor.locator.cfi;

  // Which paragraphs of chapter two are on screen right now (the section frame also holds the off-screen columns).
  const visibleParagraphs = async (): Promise<number[]> => {
    const f = await frameWith(page, "Chapter Two");
    const vp = page.viewportSize()!;
    const out: number[] = [];
    for (let n = 1; n <= 60; n++) {
      const box = await f.locator("p", { hasText: new RegExp(`^Paragraph ${n} of chapter Two`) }).first().boundingBox().catch(() => null);
      if (box && box.x >= 0 && box.x + box.width <= vp.width + 1 && box.y >= 0 && box.y + box.height <= vp.height + 1) out.push(n);
    }
    return out;
  };
  await expect.poll(async () => (await visibleParagraphs()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const firstBefore = (await visibleParagraphs())[0];
  expect(firstBefore).toBeGreaterThan(1); // we really are past the start of the chapter

  // A different text size and a narrower, taller window.
  await page.getByRole("button", { name: "Aa" }).click();
  const slider = page.getByRole("slider", { name: "Text size" });
  await slider.focus();
  for (let i = 0; i < 5; i++) await slider.press("ArrowRight");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 760, height: 900 });
  await page.reload();
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  await expect.poll(async () => (await sectionFrame(page)?.locator("body").innerText().catch(() => "")) ?? "", { timeout: 20_000 }).toContain("Chapter Two");
  await expect.poll(async () => (await visibleParagraphs()).includes(firstBefore), { timeout: 15_000, message: `paragraph ${firstBefore} should be on screen again after reflow (saved ${savedCfi})` }).toBe(true);

  // Put the reader back as other specs expect it.
  await page.getByRole("button", { name: "Aa" }).click();
  const slider2 = page.getByRole("slider", { name: "Text size" });
  await slider2.focus();
  for (let i = 0; i < 5; i++) await slider2.press("ArrowLeft");
  await page.keyboard.press("Escape");
});

// cfi-reflow for the other Foliate formats: FB2 and MOBI (generated corpus with numbered paragraphs). The place
// saved after turning pages must be the same text after a reload, after a text-size change, and after both.
for (const [title, label, chapter] of [["Corpus FB2", "FB2", "1"], ["corpus-mobi", "MOBI", "1"], ["corpus-azw3", "AZW3", "1"]] as const) {
  test(`${label}: a saved place is the same text after a reload and after a text-size change`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page);
    const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
    const t = titles.find((x) => x.title.toLowerCase() === title.toLowerCase());
    if (!t) throw new Error(`corpus fixture ${title} missing; run with LITARA_E2E_CORPUS (scripts/web/e2e.sh)`);
    const ed = ((await (await page.request.get(`/api/v1/editions?titleId=${t.id}`)).json()).items as { id: string }[])[0];
    const saved = async () => ((await (await page.request.get(`/api/v1/editions/${ed.id}/position`)).json()) as { revision: string; position: { anchor: { locator: { kind: string; cfi: string } } } | null });
    const first = (await saved()).position?.anchor.locator.cfi;

    // Which numbered paragraphs are fully on screen right now.
    const visible = async (): Promise<number[]> => {
      const f = await frameWith(page, `of chapter ${chapter}`);
      const vp = page.viewportSize()!;
      const out: number[] = [];
      for (let n = 1; n <= 90; n++) {
        const box = await f.locator("p", { hasText: new RegExp(`^Paragraph ${n} of chapter ${chapter}`) }).first().boundingBox().catch(() => null);
        if (box && box.x >= 0 && box.x + box.width <= vp.width + 1 && box.y >= 0 && box.y + box.height <= vp.height + 1) out.push(n);
      }
      return out;
    };
    const open = async () => {
      await page.goto(`/read/${ed.id}`);
      await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
      await expect.poll(async () => (await visible()).length, { timeout: 20_000 }).toBeGreaterThan(0);
    };
    await open();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next page" }).click();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 15_000 });
    await expect.poll(async () => (await saved()).position?.anchor.locator.cfi).not.toBe(first);
    expect((await saved()).position!.anchor.locator.kind).toBe("foliate-cfi");
    const lead = (await visible())[0];
    expect(lead, "turning pages moved past the first paragraph").toBeGreaterThan(1);

    await open(); // reload
    expect(await visible(), `${label}: paragraph ${lead} is on screen after a reload`).toContain(lead);

    // A larger text size re-flows the book; the same text stays on screen, then survives a reload too.
    await page.getByRole("button", { name: "Aa" }).click();
    const slider = page.getByRole("slider", { name: "Text size" });
    await slider.focus();
    for (let i = 0; i < 4; i++) await slider.press("ArrowRight");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    expect(await visible(), `${label}: paragraph ${lead} stays on screen after the text size changes`).toContain(lead);
    await page.waitForTimeout(2200); // let the position save
    await open();
    expect(await visible(), `${label}: paragraph ${lead} is on screen after reflow and reload`).toContain(lead);

    await page.getByRole("button", { name: "Aa" }).click();
    const slider2 = page.getByRole("slider", { name: "Text size" });
    await slider2.focus();
    for (let i = 0; i < 4; i++) await slider2.press("ArrowLeft");
    await page.keyboard.press("Escape");
  });
}
