import { expect, test, type Page } from "@playwright/test";
import { openEpubEdition, openTitle } from "./support";

const PASSWORD = "synthetic-fixture-password";
const ORIGIN = "http://127.0.0.1:8091";

async function signIn(page: Page, user = "fixture-user-a") {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}

async function csrf(page: Page) {
  return (await (await page.request.get("/api/v1/auth/web/session")).json()).csrfToken as string;
}

async function editionOf(page: Page): Promise<string> {
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const novel = titles.find((t) => t.title === "The Browser Novel")!; // by title: the corpus adds other EPUBs
  const eds = await (await page.request.get(`/api/v1/editions?titleId=${novel.id}`)).json();
  const id = eds.items[0].id as string;
  return id;
}

async function annotations(page: Page, edition: string) {
  const r = await page.request.get(`/api/v1/editions/${edition}/annotations?includeDeleted=false&size=200`);
  return (await r.json()).items as { id: string; revision: string; data: { kind: string; text: string } }[];
}

async function clearAnnotations(page: Page, edition: string) {
  for (const a of await annotations(page, edition)) {
    const res = await page.request.delete(`/api/v1/editions/${edition}/annotations/${a.id}`, {
      headers: { "X-CSRF-Token": await csrf(page), Origin: ORIGIN },
      data: { operationId: crypto.randomUUID(), baseRevision: a.revision, capturedAt: new Date().toISOString() },
    });
    expect(res.status()).toBe(200);
  }
}

async function openReader(page: Page) {
  await openTitle(page, "The Browser Novel");
  await openEpubEdition(page);
  await page.getByRole("link", { name: "Read" }).click();
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
}

/** Records waiting in this browser's IndexedDB, whoever owns them. */
async function stored(page: Page): Promise<{ scope: string; status: string; id: string; attempts: number }[]> {
  return page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("litara-pending", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("ops", { keyPath: "id" }); };
    req.onsuccess = () => {
      const all = req.result.transaction("ops").objectStore("ops").getAll();
      all.onsuccess = () => resolve(all.result);
    };
  }));
}

const API_WRITES = "**/api/v1/editions/*/annotations/*";
const openNotes = async (page: Page) => {
  await page.getByRole("button", { name: "Contents & notes" }).click();
  await page.getByRole("tab", { name: /Notes/ }).click();
};

test.describe.configure({ mode: "serial" });

test("a change made while the server is unreachable survives a reload and is sent afterwards", async ({ page }) => {
  await signIn(page);
  const ed = await editionOf(page);
  await clearAnnotations(page, ed);
  await openReader(page);

  await page.route(API_WRITES, (r) => r.abort("connectionrefused"));
  await page.getByRole("button", { name: "Bookmark" }).click();
  await openNotes(page);
  const item = page.getByTestId("annotation-item").first();
  await expect(item).toBeVisible();
  await expect(item.getByTestId("unsaved")).toBeVisible(); // never shown as saved
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 10_000 });
  expect(await annotations(page, ed)).toHaveLength(0);
  const rec = (await stored(page)).filter((r) => r.status === "pending");
  expect(rec.length).toBeGreaterThanOrEqual(1);

  // Reload with the server still unreachable: the write is still there and still not claimed as saved.
  await page.reload();
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  await openNotes(page);
  await expect(page.getByTestId("annotation-item").first().getByTestId("unsaved")).toBeVisible();

  // Connectivity returns: the original write is sent and the badge goes away.
  await page.unroute(API_WRITES);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await annotations(page, ed)).length, { timeout: 20_000 }).toBe(1);
  await expect(page.getByTestId("annotation-item").first().getByTestId("unsaved")).toHaveCount(0, { timeout: 20_000 });
  expect((await stored(page)).filter((r) => r.status === "pending")).toHaveLength(0);
});

test("a lost response is retried with the same operation and creates exactly one annotation", async ({ page }) => {
  await signIn(page);
  const ed = await editionOf(page);
  await clearAnnotations(page, ed);
  await openReader(page);

  // The server applies the write but the answer never reaches the browser.
  let first = true;
  await page.route(API_WRITES, async (route) => {
    if (route.request().method() === "PUT" && first) {
      first = false;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Bookmark" }).click();
  await expect.poll(async () => (await annotations(page, ed)).length, { timeout: 10_000 }).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await stored(page)).filter((r) => r.status === "pending").length, { timeout: 20_000 }).toBe(0);
  const list = await annotations(page, ed);
  expect(list).toHaveLength(1);
  expect(list[0].revision).toBe("1"); // replayed from the receipt, not applied twice
});

test("pending changes are locked at sign-out, never sent as another account, and restored for the owner", async ({ page }) => {
  await signIn(page);
  const ed = await editionOf(page);
  await clearAnnotations(page, ed);
  await openReader(page);
  await page.route(API_WRITES, (r) => r.abort("connectionrefused"));
  await page.getByRole("button", { name: "Bookmark" }).click();
  await expect.poll(async () => (await stored(page)).filter((r) => r.status === "pending").length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

  // Sign out: the protected view is gone; the record stays in the browser.
  await page.goto("/");
  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Litara" })).toBeVisible();
  const kept = (await stored(page)).filter((r) => r.status === "pending");
  expect(kept.length).toBeGreaterThanOrEqual(1);

  // Another account signs in on the same browser with the network healthy again.
  await page.unroute(API_WRITES);
  await signIn(page, "fixture-admin");
  await expect(page.getByTestId("pending-badge")).toHaveCount(0);
  const adminEd = await editionOf(page);
  await page.waitForTimeout(1500);
  expect(await annotations(page, adminEd)).toHaveLength(0); // never sent under the wrong account
  expect((await stored(page)).filter((r) => r.status === "pending").length).toBe(kept.length);
  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Litara" })).toBeVisible();

  // The owner returns: the original write is restored and delivered.
  await signIn(page);
  await expect.poll(async () => (await annotations(page, ed)).length, { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => (await stored(page)).filter((r) => r.status === "pending").length, { timeout: 20_000 }).toBe(0);
});

test("a conflicting queued edit is kept and resolved on the pending page", async ({ page }) => {
  await signIn(page);
  const ed = await editionOf(page);
  await clearAnnotations(page, ed);
  const detail = await (await page.request.get(`/api/v1/editions/${ed}`)).json();
  const id = crypto.randomUUID();
  const anchor = { fileId: detail.file.id, contentVersion: detail.file.contentVersion, locator: { kind: "foliate-cfi", version: 1, cfi: "epubcfi(/6/2!/4/2)" } };
  const headers = async () => ({ "X-CSRF-Token": await csrf(page), Origin: ORIGIN });
  const put = async (base: string, text: string) => page.request.put(`/api/v1/editions/${ed}/annotations/${id}`, {
    headers: await headers(),
    data: { operationId: crypto.randomUUID(), baseRevision: base, capturedAt: new Date().toISOString(), data: { kind: "note", anchor, selection: null, text, quote: "" } },
  });
  expect((await put("0", "original")).status()).toBe(200);

  await openReader(page);
  await openNotes(page);
  await expect(page.getByText("original")).toBeVisible();
  await page.route(API_WRITES, (r) => (r.request().method() === "GET" ? r.continue() : r.abort("connectionrefused")));
  await page.getByTestId("annotation-item").first().getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Note" }).fill("my offline edit");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("my offline edit")).toBeVisible();

  // Meanwhile another device changes it on the server.
  expect((await put("1", "changed elsewhere")).status()).toBe(200);
  await page.unroute(API_WRITES);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await stored(page)).filter((r) => r.status === "conflict").length, { timeout: 20_000 }).toBe(1);

  // The conflict is not lost and not silently merged: the person decides on the pending page.
  await page.goto("/pending");
  const row = page.getByTestId("pending-item").first();
  await expect(row.getByText("conflicts with a newer change")).toBeVisible();
  expect((await annotations(page, ed))[0].data.text).toBe("changed elsewhere");
  await row.getByRole("button", { name: "Use my change" }).click();
  await expect(page.getByTestId("pending-empty")).toBeVisible({ timeout: 15_000 });
  const after = await annotations(page, ed);
  expect(after[0].data.text).toBe("my offline edit");
  expect(Number(after[0].revision)).toBeGreaterThanOrEqual(3);
});
