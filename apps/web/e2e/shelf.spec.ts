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
