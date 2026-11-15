import { expect, test, type Page } from "@playwright/test";

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
const pred = (field: string, value: string) => ({ kind: "predicate", field, operator: "equals", value });

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
        filter: { kind: "all", children: [pred("finished", "false"), { kind: "any", children: [pred("title", "the browser novel"), pred("title", "the replaceable")] }] } },
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
