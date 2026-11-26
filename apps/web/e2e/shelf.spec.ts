import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// smart-viewer-state: a shared smart shelf asking for unfinished books is evaluated per viewer. The owner and
// another viewer differ in completion, so each sees their own matches, and finishing a book for one never
// changes the other's list. Chromium only: it creates and deletes one shelf and toggles one completion.

const PASSWORD = "synthetic-fixture-password";
const ORIGIN = "http://127.0.0.1:8091";

async function signIn(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}
const csrf = async (page: Page) => ((await (await page.request.get("/api/v1/auth/web/session")).json()) as { csrfToken: string }).csrfToken;
const rule = (field: string, operator: string, value: string) => ({ type: "rule", field, operator, value });

test("a shared smart shelf of unfinished books shows each viewer their own matches", async ({ page, browser, browserName }) => {
  test.skip(browserName !== "chromium", "shared server state; one browser is enough");
  test.setTimeout(120_000);
  await signIn(page, "fixture-user-a");
  const adminCtx = await browser.newContext({ baseURL: ORIGIN });
  const admin = await adminCtx.newPage();
  await signIn(admin, "fixture-admin");

  const ed = async (p: Page, title: string) => {
    const titles = (await (await p.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
    const t = titles.find((x) => x.title === title)!;
    return ((await (await p.request.get(`/api/v1/editions?titleId=${t.id}`)).json()).items as { id: string; file: { id: string; contentVersion: string } }[])[0];
  };
  const novel = await ed(admin, "The Browser Novel");
  const sid = crypto.randomUUID();
  const shelf = await page.request.put(`/api/v1/shelves/${sid}`, {
    headers: { "X-CSRF-Token": await csrf(page), Origin: ORIGIN },
    data: {
      operationId: crypto.randomUUID(), baseRevision: "0", capturedAt: new Date().toISOString(),
      data: { name: "Unfinished here", visibility: "shared", kind: "smart",
        filter: { type: "group", join: "AND", rules: [rule("status", "is_not", "finished"), { type: "group", join: "OR", rules: [rule("title", "is", "the browser novel"), rule("title", "is", "the replaceable")] }] } },
    },
  });
  expect(shelf.status(), await shelf.text()).toBe(200);

  const titlesOn = async (p: Page) => {
    await p.goto(`/shelves/${sid}`);
    await expect(p.getByTestId("shelf-title").first()).toBeVisible({ timeout: 15_000 });
    return (await p.getByTestId("shelf-title").allInnerTexts()).join("\n");
  };
  const finishFor = async (p: Page, event: "manual_finish" | "manual_unfinish") => {
    const cur = (await (await p.request.get(`/api/v1/editions/${novel.id}/completion`)).json()) as { revision: string };
    const r = await p.request.put(`/api/v1/editions/${novel.id}/completion`, {
      headers: { "X-CSRF-Token": await csrf(p), Origin: ORIGIN },
      data: { operationId: crypto.randomUUID(), baseRevision: cur.revision, capturedAt: new Date().toISOString(), fileId: novel.file.id, contentVersion: novel.file.contentVersion, event },
    });
    expect(r.status(), await r.text()).toBe(200);
  };
  try {
    // Both viewers start with both books unfinished.
    const ownerBefore = await titlesOn(page);
    expect(ownerBefore).toContain("The Browser Novel");
    expect(ownerBefore).toContain("The Replaceable");
    expect(await titlesOn(admin)).toContain("The Browser Novel");

    // The administrator finishes the novel: their view loses it, the owner's does not.
    await finishFor(admin, "manual_finish");
    const adminAfter = await titlesOn(admin);
    expect(adminAfter).not.toContain("The Browser Novel");
    expect(adminAfter).toContain("The Replaceable");
    const ownerAfter = await titlesOn(page);
    expect(ownerAfter).toContain("The Browser Novel"); // the owner's own state decides their list
    expect(ownerAfter).toContain("The Replaceable");
  } finally {
    await finishFor(admin, "manual_unfinish").catch(() => undefined);
    const cur = (await (await page.request.get(`/api/v1/shelves/${sid}`)).json()) as { revision: string };
    await page.request.delete(`/api/v1/shelves/${sid}`, { headers: { "X-CSRF-Token": await csrf(page), Origin: ORIGIN }, data: { operationId: crypto.randomUUID(), baseRevision: cur.revision, capturedAt: new Date().toISOString() } });
    await adminCtx.close();
  }
});

// shelf-concurrency, browser half: two tabs of one account edit a manual shelf from the same revision. One
// edit wins; the other is refused with the stale-shelf message, shows the current list, keeps a durable
// conflict, and a retry from the refreshed view succeeds exactly once (no duplicate, no lost member).
test("two tabs removing from one shelf at the same revision: one wins, the other is told and can retry", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "shared server state; one browser is enough");
  test.setTimeout(120_000);
  await signIn(page, "fixture-user-a");
  const tab2 = await page.context().newPage();
  const names = ["The Browser Novel", "The Replaceable", "The Pair"];
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const ids = names.map((n) => titles.find((t) => t.title === n)!.id);
  const headers = async () => ({ "X-CSRF-Token": await csrf(page), Origin: ORIGIN });
  const stamp = () => ({ operationId: crypto.randomUUID(), capturedAt: new Date().toISOString() });
  const sid = crypto.randomUUID();
  const created = await page.request.put(`/api/v1/shelves/${sid}`, { headers: await headers(), data: { ...stamp(), baseRevision: "0", data: { name: "Two tabs", visibility: "private", kind: "manual", filter: null } } });
  expect(created.status(), await created.text()).toBe(200);
  let revision = 1;
  for (const id of ids) {
    const r = await page.request.put(`/api/v1/shelves/${sid}/titles/${id}`, { headers: await headers(), data: { ...stamp(), baseRevision: String(revision) } });
    expect(r.status(), await r.text()).toBe(200);
    revision++;
  }
  const base = revision;
  const shown = async (p: Page) => (await p.getByTestId("shelf-title").allInnerTexts()).join("\n");
  try {
    for (const p of [page, tab2]) {
      await p.goto(`/shelves/${sid}`);
      await expect(p.getByTestId("shelf-title")).toHaveCount(3, { timeout: 15_000 });
    }
    const card = (p: Page, name: string) => p.getByTestId("shelf-title").filter({ hasText: name });

    // Tab 1 removes the first title: that wins.
    await card(page, names[0]).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("shelf-title")).toHaveCount(2, { timeout: 15_000 });

    // Tab 2 still holds the old revision and removes a different title: refused, told, list refreshed.
    await card(tab2, names[1]).getByRole("button", { name: "Remove" }).click();
    await expect(tab2.getByText("This shelf changed elsewhere")).toBeVisible({ timeout: 15_000 });
    await expect(tab2.getByTestId("shelf-title")).toHaveCount(2, { timeout: 15_000 }); // now the current list
    expect(await shown(tab2)).not.toContain(names[0]);
    expect(await shown(tab2)).toContain(names[1]); // its own removal was not applied
    const mid = (await (await page.request.get(`/api/v1/shelves/${sid}`)).json()) as { revision: string };
    expect(mid.revision).toBe(String(base + 1)); // only the winner spent a revision
    const conflicts = (await (await page.request.get(`/api/v1/personal-conflicts?resourceId=${sid}`)).json()) as { items: unknown[] };
    expect(conflicts.items).toHaveLength(1); // the refused edit is kept as a durable candidate

    // Retry from the refreshed view: it succeeds once.
    await card(tab2, names[1]).getByRole("button", { name: "Remove" }).click();
    await expect(tab2.getByTestId("shelf-title")).toHaveCount(1, { timeout: 15_000 });
    const left = (await (await page.request.get(`/api/v1/shelves/${sid}/titles`)).json()) as { items: { title: string }[] };
    expect(left.items.map((t) => t.title)).toEqual([names[2]]);
    const end = (await (await page.request.get(`/api/v1/shelves/${sid}`)).json()) as { revision: string };
    expect(end.revision).toBe(String(base + 2));
  } finally {
    const cur = (await (await page.request.get(`/api/v1/shelves/${sid}`)).json()) as { revision: string };
    await page.request.delete(`/api/v1/shelves/${sid}`, { headers: await headers(), data: { ...stamp(), baseRevision: cur.revision } });
    await tab2.close();
  }
});

// shared-shelf-permissions: an owner's shared manual shelf spans two libraries; the viewer is granted only one.
// Only the owner can edit; the viewer sees the permitted title and a count that matches, and no response to the
// viewer names the hidden title.
test("a shared manual shelf across two libraries shows a viewer only what their grants allow, and only the owner edits", async ({ page, browser, browserName }) => {
  test.skip(browserName !== "chromium", "shared server state; one browser is enough");
  test.setTimeout(120_000);
  const info = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../test-results/e2e-info.json"), "utf8")) as { libraryId: string };
  await signIn(page, "fixture-user-a");
  const adminCtx = await browser.newContext({ baseURL: ORIGIN });
  const admin = await adminCtx.newPage();
  await signIn(admin, "fixture-admin");
  const viewerCtx = await browser.newContext({ baseURL: ORIGIN });
  const viewer = await viewerCtx.newPage();
  await signIn(viewer, "fixture-user-b");

  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const visibleToOwner = titles.find((t) => t.title === "The Browser Novel")!; // in the ebook library (granted to the viewer below)
  const hidden = titles.find((t) => t.title === "Generated Fixture Title")!; // in the audiobook library (never granted to the viewer)
  const users = (await (await admin.request.get("/api/v1/admin/users?size=100")).json()).items as { id: string; username: string }[];
  const viewerId = users.find((u) => u.username === "fixture-user-b")!.id;
  const adminHeaders = async () => ({ "X-CSRF-Token": await csrf(admin), Origin: ORIGIN });
  const ownerHeaders = async () => ({ "X-CSRF-Token": await csrf(page), Origin: ORIGIN });
  const stamp = () => ({ operationId: crypto.randomUUID(), capturedAt: new Date().toISOString() });

  const sid = crypto.randomUUID();
  expect((await page.request.put(`/api/v1/shelves/${sid}`, { headers: await ownerHeaders(), data: { ...stamp(), baseRevision: "0", data: { name: "Across libraries", visibility: "shared", kind: "manual", filter: null } } })).status()).toBe(200);
  let rev = 1;
  for (const t of [visibleToOwner, hidden]) {
    const r = await page.request.put(`/api/v1/shelves/${sid}/titles/${t.id}`, { headers: await ownerHeaders(), data: { ...stamp(), baseRevision: String(rev) } });
    expect(r.status(), await r.text()).toBe(200);
    rev++;
  }
  try {
    const g = await admin.request.put(`/api/v1/admin/users/${viewerId}/libraries/${info.libraryId}`, { headers: await adminHeaders() });
    expect(g.status()).toBeLessThan(300);

    // The owner sees both titles and the editing controls.
    await page.goto(`/shelves/${sid}`);
    await expect(page.getByTestId("shelf-title")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText("2 visible")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" }).first()).toBeVisible();

    // The viewer sees only the permitted title, a matching count, and no editing controls.
    await viewer.goto(`/shelves/${sid}`);
    await expect(viewer.getByTestId("shelf-title")).toHaveCount(1, { timeout: 15_000 });
    await expect(viewer.getByTestId("shelf-title")).toContainText("The Browser Novel");
    await expect(viewer.getByText("1 visible")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: /Move .* (up|down)/ })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "Delete shelf" })).toHaveCount(0);
    await expect(viewer.getByText("Generated Fixture Title")).toHaveCount(0);

    // Nothing the viewer can fetch names the hidden title, and every edit is refused.
    const seen = [await viewer.request.get(`/api/v1/shelves/${sid}`), await viewer.request.get(`/api/v1/shelves/${sid}/titles`), await viewer.request.get("/api/v1/shelves?scope=shared")];
    for (const r of seen) {
      expect(r.status()).toBe(200);
      const body = await r.text();
      expect(body, "a viewer response leaked the hidden title id").not.toContain(hidden.id);
      expect(body).not.toContain("Generated Fixture Title");
    }
    const viewerHeaders = { "X-CSRF-Token": await csrf(viewer), Origin: ORIGIN };
    const attempts = [
      viewer.request.put(`/api/v1/shelves/${sid}/titles/${visibleToOwner.id}`, { headers: viewerHeaders, data: { ...stamp(), baseRevision: String(rev) } }),
      viewer.request.delete(`/api/v1/shelves/${sid}/titles/${visibleToOwner.id}`, { headers: viewerHeaders, data: { ...stamp(), baseRevision: String(rev) } }),
      viewer.request.put(`/api/v1/shelves/${sid}/order`, { headers: viewerHeaders, data: { ...stamp(), baseRevision: String(rev), visibleTitleIds: [visibleToOwner.id] } }),
      viewer.request.delete(`/api/v1/shelves/${sid}`, { headers: viewerHeaders, data: { ...stamp(), baseRevision: String(rev) } }),
    ];
    for (const r of await Promise.all(attempts)) expect([403, 404], await r.text()).toContain(r.status());
    const still = (await (await page.request.get(`/api/v1/shelves/${sid}/titles`)).json()) as { items: unknown[] };
    expect(still.items).toHaveLength(2); // nothing changed for the owner
  } finally {
    await admin.request.delete(`/api/v1/admin/users/${viewerId}/libraries/${info.libraryId}`, { headers: await adminHeaders() });
    const cur = (await (await page.request.get(`/api/v1/shelves/${sid}`)).json()) as { revision: string };
    await page.request.delete(`/api/v1/shelves/${sid}`, { headers: await ownerHeaders(), data: { ...stamp(), baseRevision: cur.revision } });
    await adminCtx.close();
    await viewerCtx.close();
  }
});

// ADR-0107: a smart shelf is created and then edited with the library rule builder.
test("a smart shelf is created and edited with the rule builder", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "shared server state; one browser is enough");
  test.setTimeout(120_000);
  await signIn(page, "fixture-user-a");
  await page.goto("/shelves");
  await page.getByRole("tab", { name: "New shelf" }).click();
  await page.getByLabel("Shelf name").fill("Built with rules");
  await page.getByRole("combobox", { name: "Kind" }).click();
  await page.getByRole("option", { name: "Smart" }).click();

  const create = page.getByRole("button", { name: "Create shelf" });
  await expect(create).toBeDisabled(); // the first rule has no value yet
  await page.getByRole("textbox", { name: "Author value" }).fill("eve tester");
  await create.click();
  await expect(page).toHaveURL(/\/shelves\/[0-9a-f-]{36}$/);
  const sid = page.url().split("/").pop()!;
  try {
    await expect(page.getByTestId("shelf-title").filter({ hasText: "The Browser Novel" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Edit filter" }).click();
    const value = page.getByRole("textbox", { name: "Author value" });
    await expect(value).toHaveValue("eve tester");
    await value.fill("");
    await expect(page.getByRole("button", { name: "Save filter" })).toBeDisabled();
    await value.fill("nobody at all");
    await page.screenshot({ path: "test-results/smart-shelf-editor.png", fullPage: true });
    await page.getByRole("button", { name: "Save filter" }).click();
    await expect(page.getByText("No visible titles")).toBeVisible({ timeout: 15_000 });
    const saved = (await (await page.request.get(`/api/v1/shelves/${sid}`)).json()) as { revision: string; data: { filter: unknown } };
    expect(saved.revision).toBe("2");
    expect(saved.data.filter).toEqual({ type: "group", join: "AND", rules: [{ type: "rule", field: "author", operator: "is", value: "nobody at all" }] });
  } finally {
    const cur = (await (await page.request.get(`/api/v1/shelves/${sid}`)).json()) as { revision: string };
    await page.request.delete(`/api/v1/shelves/${sid}`, { headers: { "X-CSRF-Token": await csrf(page), Origin: ORIGIN }, data: { operationId: crypto.randomUUID(), baseRevision: cur.revision, capturedAt: new Date().toISOString() } });
  }
});
