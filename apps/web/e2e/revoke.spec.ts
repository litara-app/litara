import { expect, test, type Page } from "@playwright/test";

// Removing an account's library access must clear what was loaded from it (ADR-0068, scenario
// grant-revocation): the open reader closes, cached data is dropped and unsent changes stay on the
// Pending page. Chromium only; the grant is restored afterwards because the browsers share one server.

const PASSWORD = "synthetic-fixture-password";
const ORIGIN = "http://127.0.0.1:8091";

async function signIn(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}

test("revoking library access clears the open reader and keeps unsent changes", async ({ page, browser, browserName }) => {
  test.skip(browserName !== "chromium", "shared server state; one browser is enough");
  test.setTimeout(120_000);
  await signIn(page, "fixture-user-a");
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const novel = titles.find((t) => t.title === "The Browser Novel")!;
  const ed = ((await (await page.request.get(`/api/v1/editions?titleId=${novel.id}`)).json()).items as { id: string; libraryId: string }[])[0];
  await page.goto(`/read/${ed.id}`);
  await expect(page.getByTestId("progress")).toHaveText(/\d+%/, { timeout: 30_000 });
  await expect(page.locator("iframe")).toHaveCount(1);

  const adminCtx = await browser.newContext({ baseURL: ORIGIN });
  const admin = await adminCtx.newPage();
  await signIn(admin, "fixture-admin");
  const token = ((await (await admin.request.get("/api/v1/auth/web/session")).json()) as { csrfToken: string }).csrfToken;
  const userId = ((await (await page.request.get("/api/v1/auth/web/session")).json()) as { user: { id: string } }).user.id;
  const grant = (method: "PUT" | "DELETE") => admin.request.fetch(`/api/v1/admin/users/${userId}/libraries/${ed.libraryId}`, { method, headers: { "X-CSRF-Token": token, Origin: ORIGIN } });
  try {
    expect((await grant("DELETE")).status()).toBeLessThan(300);
    // The page refetches when it becomes visible again; that is when the server's 403 reaches it.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByRole("button", { name: "Contents & notes" }).click({ timeout: 2000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "Access to this library was removed" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("iframe")).toHaveCount(0); // the reader frame and its book bytes are gone
    await expect(page.getByTestId("progress")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Review unsent changes" })).toBeVisible();
  } finally {
    expect((await grant("PUT")).status()).toBeLessThan(300); // restore for the other specs
    await adminCtx.close();
  }
});
