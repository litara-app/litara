import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openEpubEdition, openTitle } from "./support";

// T006 flows against the real Go application: app credentials, saved recipients,
// an explicit send through the server transport into a local TLS mail sink (no real
// mail is ever sent), a retained KOReader candidate, and the administrator settings.
// These tests change server state permanently, so they run once (the "admin" project).

const PASSWORD = "synthetic-fixture-password";

async function signIn(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeAttached(); // the account name is hidden at phone width
}

async function violations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
}

test.describe.configure({ mode: "serial" });

test("an app credential's password is shown once, works only for OPDS, and stops working when revoked", async ({ page, request }) => {
  await signIn(page, "fixture-user-a");
  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("link", { name: "App credentials" }).click();
  await page.getByLabel(/^Name/).fill("Browser test reader");
  await page.getByRole("button", { name: "Create credential" }).click();
  const box = page.getByTestId("one-time-secret");
  await expect(box).toBeVisible();
  const username = (await box.getByTestId("secret-username").textContent())!;
  const password = (await box.getByTestId("secret-password").textContent())!;
  expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const basic = { Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64") };
  // The secret authenticates the OPDS catalog, but not the management API. `request` carries no browser cookie,
  // so these calls prove what the secret alone can do.
  expect((await request.get("/opds/v1", { headers: basic })).status()).toBe(200);
  expect((await request.get("/api/v1/integration-credentials", { headers: basic })).status()).toBe(401);
  // Dismissing removes it everywhere in the page; a reload cannot bring it back.
  await box.getByRole("button", { name: "I have saved it" }).click();
  await expect(page.getByTestId("one-time-secret")).toHaveCount(0);
  await page.reload();
  expect(await page.content()).not.toContain(password);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain(password);
  const row = page.getByTestId("credentials-table").getByRole("row", { name: /Browser test reader/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Revoke Browser test reader" }).click();
  await row.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(page.getByTestId("credentials-table").getByRole("row", { name: /Browser test reader/ })).toHaveCount(0);
  expect((await request.get("/opds/v1", { headers: basic })).status()).toBe(401);
});

test("a person sends a file to a saved recipient through the server mail transport", async ({ page }) => {
  await signIn(page, "fixture-user-a");
  await page.goto("/settings/email");
  const add = page.getByRole("form", { name: "Add recipient" });
  await add.getByLabel(/^Name/).fill("Browser Reader");
  await add.getByLabel("Email address").fill("reader@example.invalid");
  await add.getByRole("button", { name: "Add recipient" }).click();
  await expect(page.getByTestId("recipients-table").getByRole("row", { name: /Browser Reader/ })).toBeVisible();

  await openTitle(page, "The Browser Novel");
  await openEpubEdition(page);
  const send = page.getByRole("button", { name: "Send file" });
  await expect(send).toBeDisabled(); // nothing is chosen for the person
  await page.getByRole("combobox", { name: "Recipient" }).click();
  await page.getByRole("option", { name: /Browser Reader/ }).click();
  await page.getByRole("combobox", { name: "Send through" }).click();
  await expect(page.getByRole("option", { name: "My own mail account" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("option", { name: "Server mail" }).click();
  await expect(send).toBeEnabled();
  await send.click();
  // The worker submits to the local sink; "accepted" appears only after the sink answered.
  await expect(page.getByTestId("send-status")).toContainText("Accepted by the mail server", { timeout: 30_000 });
  await expect(page.getByTestId("send-status")).not.toContainText(/delivered/i);

  await page.goto("/settings/email");
  const row = page.getByTestId("deliveries-table").getByRole("row", { name: /Browser Reader/ }).first();
  await expect(row).toContainText("Accepted by the mail server");
  await expect(row.getByRole("button", { name: "Send again…" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  // A resend needs the duplicate warning acknowledged.
  await row.getByRole("button", { name: "Send again…" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "Send again" })).toBeDisabled();
  await dlg.getByLabel(/may deliver a duplicate/).check();
  await expect(dlg.getByRole("button", { name: "Send again" })).toBeEnabled();
  await dlg.getByRole("button", { name: "Cancel" }).click();
});

test("another account cannot see these recipients or deliveries", async ({ page }) => {
  await signIn(page, "fixture-user-b");
  await page.goto("/settings/email");
  await expect(page.getByTestId("recipients-table")).toContainText("No saved recipients.");
  await expect(page.getByTestId("deliveries-table")).toContainText("Nothing has been sent yet.");
});

test("a retained KOReader position is decided by its owner and stays separate from the reader", async ({ page }) => {
  await signIn(page, "fixture-user-a");
  await page.goto("/settings/koreader");
  const card = page.getByTestId("ko-conflict").first();
  await expect(card).toContainText("Kobo B");
  await expect(card.getByTestId("ko-candidate-progress")).toHaveText("epubcfi(/6/50)");
  await expect(card).toContainText("Needs your decision");
  await card.getByRole("button", { name: "Keep the saved position" }).click();
  await expect(page.getByTestId("ko-conflict").first()).toContainText("Resolved");
  await expect(page.getByTestId("ko-none")).toBeVisible();

  await openTitle(page, "The Browser Novel");
  await openEpubEdition(page);
  const pos = page.getByTestId("ko-position");
  await expect(pos).toContainText("Kobo A");
  await expect(pos).toContainText("30.0%");
  await expect(pos).toContainText("separate");
  // The Litara reader position and finished status are untouched.
  await expect(page.getByRole("button", { name: "Mark finished" })).toBeVisible();
});

test("administrators manage services and the server mail transport; others cannot", async ({ page }) => {
  await signIn(page, "fixture-admin");
  await page.getByRole("link", { name: "Administration" }).click();
  await page.getByRole("link", { name: "Integrations", exact: true }).click();
  const form = page.getByRole("form", { name: "Integration settings" });
  await expect(form.getByLabel("Email delivery")).toBeChecked();
  await form.getByLabel(/Emails per person/).fill("42");
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/integrations/settings") && r.request().method() === "PUT");
  await form.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("form", { name: "Integration settings" }).getByLabel(/Emails per person/)).toHaveValue("42");
  const mail = page.getByRole("form", { name: "Server mail settings" });
  await expect(mail.getByLabel(/Mail server host/)).toHaveValue("127.0.0.1");
  await expect(mail.getByLabel(/New password|Password/).first()).toHaveValue("");
  // The test connects and signs in against the local sink and sends no message.
  await mail.getByRole("button", { name: "Test saved settings" }).click();
  await expect(page.getByTestId("smtp-test-result")).toContainText("No message was sent");
  // The server refuses regardless of the UI.
  await page.context().clearCookies();
  await signIn(page, "fixture-user-a");
  expect((await page.request.get("/api/v1/admin/delivery/smtp")).status()).toBe(403);
  await page.goto("/admin/integrations");
  await expect(page.getByText("Your account is not an administrator.")).toBeVisible();
});

for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "phone", width: 375, height: 812 }]) {
  test.describe(`${viewport.name} accessibility`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    for (const [label, path, user] of [
      ["app credentials", "/settings/credentials", "fixture-user-a"], ["email settings", "/settings/email", "fixture-user-a"],
      ["KOReader settings", "/settings/koreader", "fixture-user-a"], ["admin integrations", "/admin/integrations", "fixture-admin"],
    ] as const) {
      test(`${label} has no violations and no horizontal scroll`, async ({ page }) => {
        await signIn(page, user);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(await violations(page)).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
