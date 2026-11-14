import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "synthetic-fixture-password";
const ORIGIN = "http://127.0.0.1:8091";

async function signIn(page: Page, user = "fixture-user-a") {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}

async function openComic(page: Page, title: string) {
  await page.goto("/");
  await page.getByLabel("Search").fill(title);
  await page.getByText(title, { exact: true }).click();
  await page.getByTestId("edition-card").first().getByRole("link").click();
  await page.getByRole("link", { name: "Read" }).click();
}

async function editionId(page: Page, title: string): Promise<string> {
  const titles = await (await page.request.get(`/api/v1/titles?q=${encodeURIComponent(title)}`)).json();
  const t = titles.items.find((x: { title: string }) => x.title === title);
  const eds = await (await page.request.get(`/api/v1/editions?titleId=${t.id}`)).json();
  return eds.items[0].id;
}

/** The dominant color of the page the reader is showing, read from the decoded image itself. */
async function pageColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>("[data-testid=comic-page]");
    if (!img || !img.complete || !img.naturalWidth) return "loading";
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(5, 5, 1, 1).data;
    return r > 200 ? "red" : g > 200 ? "green" : b > 200 ? "blue" : `${r},${g},${b}`;
  });
}

async function csrf(page: Page) {
  return (await (await page.request.get("/api/v1/auth/web/session")).json()).csrfToken as string;
}

async function clearAnnotations(page: Page, edition: string) {
  const list = await (await page.request.get(`/api/v1/editions/${edition}/annotations?includeDeleted=false&size=200`)).json();
  for (const a of list.items) {
    const res = await page.request.delete(`/api/v1/editions/${edition}/annotations/${a.id}`, {
      headers: { "X-CSRF-Token": await csrf(page), Origin: ORIGIN },
      data: { operationId: crypto.randomUUID(), baseRevision: a.revision, capturedAt: new Date().toISOString() },
    });
    expect(res.status()).toBe(200);
  }
}

const progress = (page: Page) => page.getByTestId("comic-progress");

test.describe.configure({ mode: "serial" });

test("a comic opens after one-time extraction, in natural page order, and resumes where it was left", async ({ page }) => {
  await signIn(page);
  await openComic(page, "The Test Comic");
  await expect(progress(page)).toHaveText(/Page \d of 3/, { timeout: 30_000 });
  await page.keyboard.press("Home");
  await expect(progress(page)).toHaveText("Page 1 of 3");
  await expect.poll(() => pageColor(page)).toBe("red"); // 1.png

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(progress(page)).toHaveText("Page 2 of 3");
  await expect.poll(() => pageColor(page)).toBe("green"); // 2.png

  await page.keyboard.press("End");
  await expect(progress(page)).toHaveText("Page 3 of 3");
  await expect.poll(() => pageColor(page)).toBe("blue"); // 10.png sorts after 2.png: natural order, not text order

  await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 15_000 });
  const id = await editionId(page, "The Test Comic");
  const saved = await (await page.request.get(`/api/v1/editions/${id}/position`)).json();
  expect(saved.position.anchor.locator).toMatchObject({ kind: "comic-page", pageIndex: 2 });
  expect(saved.position.anchor.locator.entryId).toMatch(/^[a-f0-9]{64}$/);

  await page.reload();
  await expect(progress(page)).toHaveText("Page 3 of 3", { timeout: 30_000 }); // by entry identity, not the first page
  await expect.poll(() => pageColor(page)).toBe("blue");

  // Right-to-left reverses the arrow keys.
  await page.getByRole("button", { name: "View" }).click();
  await page.getByText("Right to left (manga)").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // arrows go to the reader, not the settings control
  await page.keyboard.press("ArrowRight");
  await expect(progress(page)).toHaveText("Page 2 of 3");
});

test("bookmarks and page notes anchor to a page identity; highlights are not offered", async ({ page }) => {
  await signIn(page);
  const id = await editionId(page, "The Test Comic");
  await clearAnnotations(page, id);
  await openComic(page, "The Test Comic");
  await expect(progress(page)).toHaveText(/Page \d of 3/, { timeout: 30_000 });
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await page.getByRole("button", { name: /Bookmarks/ }).click();
  await page.getByRole("button", { name: "Add note for this page" }).click();
  await page.getByRole("textbox", { name: "Note" }).fill("Great splash page");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Text highlights are not available for image pages.")).toBeVisible();
  await expect(page.getByTestId("annotation-item")).toHaveCount(2, { timeout: 10_000 });

  await expect.poll(async () => (await (await page.request.get(`/api/v1/editions/${id}/annotations?includeDeleted=false`)).json()).items.length, { timeout: 15_000 }).toBe(2);
  const list = await (await page.request.get(`/api/v1/editions/${id}/annotations?includeDeleted=false`)).json();
  expect(list.items.map((a: { data: { kind: string } }) => a.data.kind).sort()).toEqual(["bookmark", "note"]);
  for (const a of list.items) {
    expect(a.data.selection).toBeNull();
    expect(a.data.anchor.locator).toMatchObject({ kind: "comic-page", pageIndex: 0, version: 1 });
  }
  // The server refuses a text highlight on an image comic outright.
  const detail = await (await page.request.get(`/api/v1/editions/${id}`)).json();
  const bad = await page.request.put(`/api/v1/editions/${id}/annotations/${crypto.randomUUID()}`, {
    headers: { "X-CSRF-Token": await csrf(page), Origin: ORIGIN },
    data: { operationId: crypto.randomUUID(), baseRevision: "0", capturedAt: new Date().toISOString(),
      data: { kind: "highlight", text: "", quote: "x", selection: { kind: "foliate-range", version: 1, cfi: "epubcfi(/6/2,/1:0,/1:1)" },
        anchor: { fileId: detail.file.id, contentVersion: detail.file.contentVersion, locator: { kind: "foliate-cfi", version: 1, cfi: "epubcfi(/6/2)" } } } },
  });
  expect(bad.status()).toBe(422);
});

test("a hostile archive and an unsupported CBR are explained, with no pages and the original offered", async ({ page }) => {
  await signIn(page);
  await openComic(page, "The Hostile Comic");
  const box = page.getByTestId("comic-unsupported");
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box).toContainText("cannot be shown");
  await expect(box.getByRole("link", { name: "Download original" })).toBeVisible();
  await expect(page.getByTestId("comic-page")).toHaveCount(0);

  await openComic(page, "legacy");
  await expect(page.getByTestId("comic-unsupported")).toContainText("CBR extraction is not available", { timeout: 30_000 });
});

test("page images require the signed-in session", async ({ page, playwright }) => {
  await signIn(page);
  const id = await editionId(page, "The Test Comic");
  const ed = await (await page.request.get(`/api/v1/editions/${id}`)).json();
  const url = `/api/v1/files/${ed.file.id}/versions/${ed.file.contentVersion}/pages/0`;
  const ok = await page.request.get(url);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toContain("no-store");
  const anon = await playwright.request.newContext({ baseURL: ORIGIN });
  expect((await anon.get(url)).status()).toBe(401);
  await anon.dispose();
});
