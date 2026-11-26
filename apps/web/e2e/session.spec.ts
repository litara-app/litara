import { expect, test, type Page } from "@playwright/test";

// web-cookie-csrf, manual-ebook-finish and reader-bridge-forgery (logout closes the reader) in real browsers.

const PASSWORD = "synthetic-fixture-password";
const ORIGIN = "http://127.0.0.1:8091";

async function signIn(page: Page, user = "fixture-user-a") {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeAttached(); // the account name is hidden at phone width
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
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("a server engine profile the page does not bundle disables restore, painting and saving, with an explicit message", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const { editionId } = await novel(page);
  const revision = async () => ((await (await page.request.get(`/api/v1/editions/${editionId}/position`)).json()) as { revision: string }).revision;
  const before = await revision();
  await page.route(`**/api/v1/editions/${editionId}/reader`, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { engineProfile: string };
    await route.fulfill({ response: res, json: { ...body, engineProfile: "foliate-js@some-other-build/profile-1" } });
  });
  await page.goto(`/read/${editionId}`);
  await expect(page.getByTestId("profile-mismatch")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("profile-mismatch")).toContainText("Reload");
  await expect(page.getByRole("button", { name: "Bookmark", exact: true })).toBeDisabled();
  // Turn pages: no position may be written under a profile this page cannot vouch for.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(3500); // longer than the position save delay
  expect(await revision()).toBe(before);
});

test("the reader can finish and unfinish the book explicitly, after a confirmation, without moving the reading place", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const { editionId } = await novel(page);
  const completion = async () => (await (await page.request.get(`/api/v1/editions/${editionId}/completion`)).json()) as { finished: boolean };
  if ((await completion()).finished) { // shared server: start unfinished
    const csrfTok = await csrf(page);
    const cur = (await (await page.request.get(`/api/v1/editions/${editionId}/completion`)).json()) as { revision: string };
    const eds = (await (await page.request.get(`/api/v1/editions/${editionId}`)).json()) as { file: { id: string; contentVersion: string } };
    await page.request.put(`/api/v1/editions/${editionId}/completion`, { headers: { "X-CSRF-Token": csrfTok, Origin: ORIGIN },
      data: { operationId: crypto.randomUUID(), baseRevision: cur.revision, capturedAt: new Date().toISOString(), fileId: eds.file.id, contentVersion: eds.file.contentVersion, event: "manual_unfinish" } });
  }
  await page.goto(`/read/${editionId}`);
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  const pos = async () => ((await (await page.request.get(`/api/v1/editions/${editionId}/position`)).json()) as { revision: string }).revision;
  const before = await pos();
  await page.getByRole("button", { name: "Contents & notes", exact: true }).click();
  await page.getByRole("button", { name: "Mark finished…" }).click();
  expect((await completion()).finished).toBe(false); // asking is not finishing
  await page.getByRole("button", { name: "Mark finished", exact: true }).click(); // the confirmation, not the button that opened it
  await expect(page.getByTestId("finished-badge")).toBeVisible({ timeout: 10_000 });
  expect((await completion()).finished).toBe(true);
  expect(await pos()).toBe(before);
  await page.getByRole("button", { name: "Mark unfinished…" }).click();
  await page.getByRole("button", { name: "Mark unfinished", exact: true }).click(); // the confirmation, not the button that opened it
  await expect(page.getByTestId("finished-badge")).toHaveCount(0, { timeout: 10_000 });
  expect((await completion()).finished).toBe(false);
});

test("finishing one of two editions of a work finishes only that edition and adds its own history", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string; editionCount: number }[];
  const pair = titles.find((t) => t.title === "The Pair");
  if (!pair) throw new Error("fixture 'The Pair' missing");
  expect(pair.editionCount).toBe(2); // two editions of one work
  const eds = ((await (await page.request.get(`/api/v1/editions?titleId=${pair.id}`)).json()) as { items: { id: string }[] }).items;
  expect(eds).toHaveLength(2);
  const [one, other] = eds;
  const finished = async (id: string) => ((await (await page.request.get(`/api/v1/editions/${id}/completion`)).json()) as { finished: boolean }).finished;
  const position = async (id: string) => ((await (await page.request.get(`/api/v1/editions/${id}/position`)).json()) as { revision: string }).revision;
  expect(await finished(one.id)).toBe(false);
  expect(await finished(other.id)).toBe(false);
  const posBefore = [await position(one.id), await position(other.id)];
  const history = async () => ((await (await page.request.get(`/api/v1/titles/${pair.id}/reading-history`)).json()) as { items: { event: string; editionId?: string }[] }).items;
  const historyBefore = (await history()).length;

  // Reading to the end does not finish anything: open the first edition and go to its last chapter.
  await page.goto(`/read/${one.id}`);
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Contents & notes", exact: true }).click();
  await page.getByRole("dialog").getByText("Chapter Three", { exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Contents & notes" })).toBeHidden(); // a click while it closes is swallowed
  expect(await finished(one.id)).toBe(false); // no automatic finish at the end of the book

  // Explicit finish from the reader menu.
  await page.getByRole("button", { name: "Contents & notes", exact: true }).click();
  await page.getByRole("button", { name: "Mark finished…" }).click();
  await page.getByRole("button", { name: "Mark finished", exact: true }).click(); // the confirmation, not the button that opened it
  await expect(page.getByTestId("finished-badge")).toBeVisible({ timeout: 10_000 });
  expect(await finished(one.id)).toBe(true);
  expect(await finished(other.id)).toBe(false); // the sibling edition is untouched
  expect(await position(other.id)).toBe(posBefore[1]);
  const after = await history();
  expect(after.length).toBe(historyBefore + 1); // exactly one new history entry, for the finish
  expect(after.some((h) => h.event === "manual_finish")).toBe(true);

  // Leave the shared server as found.
  await page.getByRole("button", { name: "Mark unfinished…" }).click();
  await page.getByRole("button", { name: "Mark unfinished", exact: true }).click(); // the confirmation, not the button that opened it
  await expect(page.getByTestId("finished-badge")).toHaveCount(0, { timeout: 10_000 });
  expect(await finished(one.id)).toBe(false);
});
