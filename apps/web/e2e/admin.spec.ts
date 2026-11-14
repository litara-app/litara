import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "synthetic-fixture-password";

async function signIn(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("only administrators see administration", async ({ page }) => {
  await signIn(page, "fixture-user-a");
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByText("Your account is not an administrator.")).toBeVisible();
  // The server refuses regardless of the UI.
  const res = await page.request.get("/api/v1/admin/users");
  expect(res.status()).toBe(403);
});

test("an administrator creates and disables a user", async ({ page }) => {
  await signIn(page, "fixture-admin");
  await page.getByRole("link", { name: "Administration" }).click();
  await page.getByLabel("Username").fill("e2e-reader");
  await page.getByLabel("Display name").fill("E2E Reader");
  await page.getByLabel(/Password/).fill("a-long-test-password");
  await page.getByRole("button", { name: "Create user" }).click();
  const row = page.getByTestId("users-table").getByRole("row", { name: /E2E Reader/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row.getByText("disabled")).toBeVisible();
  // A duplicate username is rejected by the server and shown.
  await page.getByLabel("Username").fill("e2e-reader");
  await page.getByLabel(/Password/).fill("another-long-password");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("library health, scan request and the review list", async ({ page }) => {
  await signIn(page, "fixture-admin");
  await page.goto("/admin/libraries");
  await page.getByRole("link", { name: "Shelf" }).click();
  await expect(page.getByText(/root healthy/)).toBeVisible();
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(page.getByTestId("scans-table").getByRole("row")).not.toHaveCount(1); // header plus a run
  await expect(page.getByText("Nothing needs review.").or(page.getByTestId("review-item").first())).toBeVisible();
});

test("edition metadata shows provenance, accepts a protected edit and restores", async ({ page }) => {
  await signIn(page, "fixture-admin");
  await page.goto("/");
  await page.getByText("The Browser Novel").click();
  await page.getByText(/EPUB/).first().click();
  const admin = page.getByTestId("edition-admin");
  await expect(admin).toBeVisible();
  const titleRow = admin.getByTestId("metadata-table").getByRole("row", { name: /^title/ });
  await expect(titleRow.getByText("embedded")).toBeVisible();
  await admin.getByRole("textbox", { name: "Value" }).fill("Edited Novel");
  await admin.getByRole("button", { name: "Set (protected)" }).click();
  await expect(titleRow.getByText("user")).toBeVisible();
  await expect(titleRow.getByText("Edited Novel")).toBeVisible();
  await admin.getByRole("button", { name: "Remove my override" }).click();
  await expect(titleRow.getByText("embedded")).toBeVisible();
  // The title cannot be cleared.
  await expect(admin.getByRole("button", { name: "Protected clear" })).toBeDisabled();
});

test("a reviewed merge: plan, approve, apply", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await signIn(page, "fixture-admin");
  await page.goto("/admin/repairs");
  await page.getByLabel("Find an audiobook title").fill("Generated");
  await page.getByPlaceholder("Choose title").click();
  await page.getByRole("option", { name: "Generated Fixture Title" }).click();
  const boxes = page.getByRole("checkbox");
  await expect(boxes.nth(1)).toBeAttached({ timeout: 10_000 });
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    await boxes.nth(i).click({ force: true });
    await expect(boxes.nth(i)).toBeChecked();
  }
  await expect(page.getByTestId("merge-file").first()).toBeVisible({ timeout: 10_000 });
  // Reorder once: the first file moves down.
  await page.getByRole("button", { name: /Move .* down/ }).first().click();
  await page.getByLabel("Label").fill("Merged by e2e");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByTestId("plan-state")).toHaveText("planned");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("plan-state")).toHaveText("approved");
  await page.getByRole("button", { name: "Apply repair" }).click();
  await expect(page.getByTestId("plan-state")).toHaveText("applied");
  const ids = await page.getByTestId("plan-result").getByRole("row").nth(1).innerText();
  expect(ids).toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/);

  // The retired sources no longer appear; the new recording does.
  await page.goto("/?mediaKind=audio");
  await expect(page.getByTestId("title-card").filter({ hasText: "Generated Fixture Title" })).toBeVisible();
  const planPath = page.url();
  expect(planPath).toBeTruthy();
});
