import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// edition-replacement, browser half: a book replaced on disk while a reader has it open keeps its edition and
// file identity with a new content version. The open reader's next save is refused (412), the reader says so and
// stops saving, no old location is applied, and a reload opens the new version. Chromium only: it changes shared
// server state (a dedicated fixture book that no other spec reads).

const PASSWORD = "synthetic-fixture-password";
const ORIGIN = "http://127.0.0.1:8091";

async function signIn(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeAttached(); // the account name is hidden at phone width
}

type Edition = { id: string; file: { id: string; contentVersion: string } };
async function replaceable(page: Page): Promise<Edition> {
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const t = titles.find((x) => x.title === "The Replaceable");
  if (!t) throw new Error("fixture 'The Replaceable' missing");
  return ((await (await page.request.get(`/api/v1/editions?titleId=${t.id}`)).json()).items as Edition[])[0];
}

test("a book replaced on disk: same edition and file, new version; the open reader stops saving and a reload opens the new one", async ({ page, browser, browserName }) => {
  test.skip(browserName !== "chromium", "changes shared server state; one browser is enough");
  test.setTimeout(180_000);
  const info = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../test-results/e2e-info.json"), "utf8")) as { libraryRoot: string; libraryId: string };
  const file = path.join(info.libraryRoot, "Eve Tester", "replaceable.epub");

  await signIn(page, "fixture-user-a");
  const before = await replaceable(page);
  await page.goto(`/read/${before.id}`);
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  await expect(page.getByTestId("save-status")).toHaveText(/position saved/i, { timeout: 15_000 }); // the opening location is saved against the old version
  const positionBefore = (await (await page.request.get(`/api/v1/editions/${before.id}/position`)).json()) as { revision: string };

  // Replace the bytes (same path), then let two scans see a stable file.
  const original = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.concat([original, Buffer.from("PADDING-AFTER-THE-ARCHIVE")]));
  try {
    const adminCtx = await browser.newContext({ baseURL: ORIGIN });
    const admin = await adminCtx.newPage();
    await signIn(admin, "fixture-admin");
    const token = ((await (await admin.request.get("/api/v1/auth/web/session")).json()) as { csrfToken: string }).csrfToken;
    for (let i = 0; i < 3; i++) {
      const r = await admin.request.post(`/api/v1/admin/libraries/${info.libraryId}/scans`, { headers: { "X-CSRF-Token": token, Origin: ORIGIN }, data: {} });
      expect([202, 409]).toContain(r.status());
      await admin.waitForTimeout(1500); // the e2e server runs queued scans and moves its clock on
    }
    await adminCtx.close();
    await expect.poll(async () => (await replaceable(page)).file.contentVersion, { timeout: 30_000 }).not.toBe(before.file.contentVersion);
    const after = await replaceable(page);
    expect(after.id).toBe(before.id); // same edition
    expect(after.file.id).toBe(before.file.id); // same file identity, new version

    // The old version is refused, so the open reader's next position save is rejected.
    const old = await page.request.get(`/api/v1/files/${before.file.id}/versions/${before.file.contentVersion}/content`);
    expect(old.status()).toBe(412);
    await page.getByRole("button", { name: "Next page" }).click();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("This book file changed")).toBeVisible({ timeout: 30_000 });
    // No old location was applied to the server.
    const positionAfter = (await (await page.request.get(`/api/v1/editions/${before.id}/position`)).json()) as { revision: string };
    expect(positionAfter.revision).toBe(positionBefore.revision);

    // A reload opens the new version with no warning.
    await page.reload();
    await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
    await expect(page.getByText("This book file changed")).toHaveCount(0);
  } finally {
    fs.writeFileSync(file, original); // restore the original bytes for later runs
  }
});
