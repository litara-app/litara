import { expect, test, type Page } from "@playwright/test";

// web-cookie-csrf, manual-ebook-finish and reader-bridge-forgery (logout closes the reader) in real browsers.

const PASSWORD = "synthetic-fixture-password";
const ORIGIN = "http://127.0.0.1:8091";

async function signIn(page: Page, user = "fixture-user-a") {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}
const csrf = async (page: Page) => ((await (await page.request.get("/api/v1/auth/web/session")).json()) as { csrfToken: string }).csrfToken;

async function novel(page: Page) {
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const t = titles.find((x) => x.title === "The Browser Novel")!;
  const ed = ((await (await page.request.get(`/api/v1/editions?titleId=${t.id}`)).json()).items as { id: string }[])[0];
  return { titleId: t.id, editionId: ed.id };
}

test.describe.configure({ mode: "serial" });

test("the session cookie is HttpOnly, script cannot read it, and a missing or wrong CSRF token is rejected", async ({ page, context }) => {
  await signIn(page);
  const cookies = await context.cookies(); // not filtered by URL: the cookie may be scoped to a path such as /api
  const session = cookies; // every cookie this origin sets belongs to the session
  expect(session.length).toBeGreaterThan(0);
  for (const c of session) expect(c.httpOnly, `${c.name} must be HttpOnly`).toBe(true);
  expect(await page.evaluate(() => document.cookie)).toBe(""); // nothing readable from script
  const { editionId } = await novel(page);
  const url = `/api/v1/editions/${editionId}/completion`;
  const body = { operationId: crypto.randomUUID(), baseRevision: "0", capturedAt: new Date().toISOString(), event: "manual_finish" };
  for (const headers of [{ Origin: ORIGIN }, { Origin: ORIGIN, "X-CSRF-Token": "wrong-token" }]) {
    const r = await page.request.put(url, { headers, data: body });
    expect(r.status(), JSON.stringify(headers)).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("csrf_failed");
  }
});

test("finishing a book is explicit, touches only that edition's completion, and leaves the reading place alone", async ({ page }) => {
  await signIn(page);
  const { titleId, editionId } = await novel(page);
  const position = async () => (await (await page.request.get(`/api/v1/editions/${editionId}/position`)).json()) as { revision: string };
  const completion = async () => (await (await page.request.get(`/api/v1/editions/${editionId}/completion`)).json()) as { finished: boolean };
  // Make sure we start unfinished (earlier runs share the server).
  if ((await completion()).finished) {
    await page.goto(`/editions/${editionId}`);
    await page.getByRole("button", { name: "Mark unfinished" }).click();
    await expect(page.getByRole("button", { name: "Mark finished" })).toBeVisible();
  }
  const before = await position();
  await page.goto(`/editions/${editionId}`);
  expect((await completion()).finished).toBe(false); // opening a book never finishes it
  await page.getByRole("button", { name: "Mark finished" }).click();
  await expect(page.getByRole("button", { name: "Mark unfinished" })).toBeVisible();
  expect((await completion()).finished).toBe(true);
  expect((await position()).revision).toBe(before.revision); // the saved place is untouched
  const history = (await (await page.request.get(`/api/v1/titles/${titleId}/reading-history`)).json()) as { items: { event: string }[] };
  expect(history.items.some((h) => h.event === "manual_finish")).toBe(true);
  await page.getByRole("button", { name: "Mark unfinished" }).click();
  await expect(page.getByRole("button", { name: "Mark finished" })).toBeVisible();
  const after = (await (await page.request.get(`/api/v1/titles/${titleId}/reading-history`)).json()) as { items: { event: string }[] };
  expect(after.items.length).toBeGreaterThan(history.items.length); // history only grows
});

test("ending the session closes the open reader and its book channel", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const { editionId } = await novel(page);
  await page.goto(`/read/${editionId}`);
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  await expect(page.locator("iframe")).toHaveCount(1);
  const r = await page.request.post("/api/v1/auth/web/logout", { headers: { "X-CSRF-Token": await csrf(page), Origin: ORIGIN } });
  expect(r.status()).toBeLessThan(300);
  // The next server contact notices; a bookmark attempt is that contact.
  await page.getByRole("button", { name: "Bookmark" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.locator("iframe")).toHaveCount(0);
});
