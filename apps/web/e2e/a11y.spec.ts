import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "synthetic-fixture-password";

async function signIn(page: Page, user = "fixture-admin") {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}

async function violations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function ids(page: Page) {
  const eds = await (await page.request.get("/api/v1/editions?size=200")).json();
  const recs = await (await page.request.get("/api/v1/recordings?size=200")).json();
  const by = (f: string) => eds.items.find((e: { file: { format: string } }) => e.file.format === f);
  const comicTitle = (await (await page.request.get("/api/v1/titles?q=The%20Test%20Comic")).json()).items[0].id;
  const comic = (await (await page.request.get(`/api/v1/editions?titleId=${comicTitle}`)).json()).items[0];
  return { epub: by("epub").id as string, title: by("epub").titleId as string, cbz: comic.id as string,
    rec: recs.items.find((r: { durationMs: number }) => r.durationMs === 180_000).id as string, lib: by("epub").libraryId as string };
}

const screens: [string, (i: Awaited<ReturnType<typeof ids>>) => string][] = [
  ["library", () => "/"], ["title", (i) => `/titles/${i.title}`], ["edition (admin tools)", (i) => `/editions/${i.epub}`],
  ["shelves", () => "/shelves"], ["pending changes", () => "/pending"], ["admin users", () => "/admin"], ["admin libraries", () => "/admin/libraries"],
  ["admin library", (i) => `/admin/libraries/${i.lib}`], ["repair builder", () => "/admin/repairs"],
];

for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "phone", width: 375, height: 812 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("sign-in has no accessibility violations and no horizontal scroll", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in to Litara" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    for (const [name, path] of screens) {
      test(`${name}: axe WCAG A/AA, labelled controls, no page-level horizontal scroll`, async ({ page }) => {
        await signIn(page);
        const i = await ids(page);
        await page.goto(path(i));
        await page.waitForLoadState("networkidle");
        await expect(page.locator("main, [role=main]").first()).toBeVisible();
        expect(await violations(page)).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      });
    }

    test("reader, listener and comic reader chrome", async ({ page }) => {
      await signIn(page);
      const i = await ids(page);
      await page.goto(`/read/${i.epub}`);
      await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
      expect(await violations(page)).toEqual([]);
      await page.goto(`/listen/${i.rec}`);
      await expect(page.getByTestId("total")).toHaveText("3:00");
      expect(await violations(page)).toEqual([]);
      await page.goto(`/read/${i.cbz}`);
      await expect(page.getByTestId("comic-progress")).toBeVisible({ timeout: 30_000 });
      expect(await violations(page)).toEqual([]);
    });
  });
}

test("keyboard: every primary control is reachable and dialogs trap and release focus", async ({ page, browserName }) => {
  // Safari/WebKit does not move Tab focus to buttons by default (a platform setting), so Tab order is only meaningful in Chromium and Firefox.
  test.skip(browserName === "webkit", "WebKit does not Tab to buttons by default");
  await signIn(page);
  const i = await ids(page);
  await page.goto("/");
  await expect(page.getByTestId("title-card").first()).toBeVisible();
  const seen = new Set<string>();
  for (let n = 0; n < 12; n++) {
    await page.keyboard.press("Tab");
    seen.add(await page.evaluate(() => { const a = document.activeElement as HTMLElement; return `${a.tagName}:${(a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 30)}`; }));
  }
  expect(seen.size).toBeGreaterThan(5);
  await page.goto(`/read/${i.epub}`);
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  const opener = page.getByRole("button", { name: "Contents & notes" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let n = 0; n < 8; n++) await page.keyboard.press("Tab"); // focus stays inside the dialog
  expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused(); // focus returns to what opened it
});
