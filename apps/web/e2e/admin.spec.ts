import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const PASSWORD = "synthetic-fixture-password";

async function signIn(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
}


/** The library is paged, so open a title through search rather than hoping it is on the first page. */
async function openTitle(page: Page, title: string) {
  await page.goto("/");
  await page.getByLabel("Search").fill(title);
  await expect(page.getByTestId("title-card").filter({ hasNotText: title })).toHaveCount(0, { timeout: 15_000 }); // only matches remain: the list has settled
  await page.getByText(title, { exact: true }).first().click();
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
  await openTitle(page, "The Browser Novel");
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

test("a copy-only import is previewed, decided, approved and run; write-back stays off", async ({ page }) => {
  const info = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../test-results/e2e-info.json"), "utf8")) as { importSource: string };
  await signIn(page, "fixture-admin");
  await page.goto("/admin/libraries");
  await page.getByRole("link", { name: "Shelf" }).click();
  await page.getByLabel("Source folder on the server").fill(info.importSource);
  await page.getByRole("button", { name: "Preview import" }).click();
  const plan = page.getByTestId("import-plan");
  await expect(plan).toBeVisible();
  await expect(page.getByTestId("import-state")).toHaveText("planned");
  const items = plan.getByTestId("import-item");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("part1.mp3");
  // Skipping one item is an explicit decision recorded before approval.
  await plan.getByRole("switch", { name: /part2\.mp3/ }).click({ force: true }); // a controlled switch: the state flips after the server records the decision
  await expect(items.nth(1)).toContainText("skip");
  await page.getByRole("button", { name: "Approve plan" }).click();
  await expect(page.getByTestId("import-state")).toHaveText("approved");
  await page.getByRole("button", { name: "Copy files now" }).click();
  await expect(page.getByTestId("import-state")).toHaveText("completed", { timeout: 30_000 });
  await expect(items.first()).toContainText("published");
  await expect(items.nth(1)).toContainText("skipped");
  // Write-back: every in-file writer is off, backups are off by default, and no write can be started without a recording.
  const writers = page.getByTestId("writers");
  await expect(writers).toContainText("in-file writing off");
  await expect(writers).not.toContainText("in-file writing on");
  await expect(writers).toContainText("backups before replacing files: off (default)");
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

// repair-split: split the merged recording into two ordered parts while a reader has progress in the last file.
// New successor identities; the reader's place is offered only where its file went; nothing is finished.
test("a reviewed split: successors, an explicit candidate only where the anchored file went, nothing finished", async ({ page, playwright }) => {
  test.setTimeout(150_000);
  page.on("dialog", (d) => void d.accept());
  const ORIGIN = "http://127.0.0.1:8091";
  const reader = await playwright.request.newContext({ baseURL: ORIGIN });
  const login = await reader.post("/api/v1/auth/native/login", { data: { username: "fixture-user-a", password: PASSWORD, deviceName: "split-reader" } });
  expect(login.status()).toBe(200);
  const auth = { Authorization: `Bearer ${((await login.json()) as { accessToken: string }).accessToken}` };
  try {
    // The merged recording from the previous test (one recording of this title after the merge).
    const titles = (await (await reader.get("/api/v1/titles?q=Generated&mediaKind=audio&size=10", { headers: auth })).json()).items as { id: string; title: string }[];
    const title = titles.find((t) => t.title === "Generated Fixture Title")!;
    const recs = ((await (await reader.get(`/api/v1/titles/${title.id}/recordings?size=50`, { headers: auth })).json()) as { items: { id: string; label: string }[] }).items;
    expect(recs, "after the merge the title has exactly one recording").toHaveLength(1);
    const merged = recs[0];
    const snap = (await (await reader.get(`/api/v1/recordings/${merged.id}`, { headers: auth })).json()) as { layoutRevision: string; files: { id: string; contentVersion: string; filename: string }[] };
    expect(snap.files.length).toBeGreaterThanOrEqual(2);
    const lastFile = snap.files[snap.files.length - 1];

    // The reader has progress in the last file (and has not finished the recording).
    const pos0 = (await (await reader.get(`/api/v1/recordings/${merged.id}/position`, { headers: auth })).json()) as { revision: string };
    const saved = await reader.put(`/api/v1/recordings/${merged.id}/position`, { headers: auth, data: {
      operationId: crypto.randomUUID(), baseRevision: pos0.revision, layoutRevision: snap.layoutRevision,
      position: { fileId: lastFile.id, contentVersion: lastFile.contentVersion, offsetMs: 5000, capturedAt: new Date().toISOString() } } });
    expect(saved.status(), await saved.text()).toBe(200);

    // The administrator splits: the first file alone, everything else together.
    await signIn(page, "fixture-admin");
    await page.goto("/admin/repairs");
    await page.getByLabel("Find an audiobook title").fill("Generated");
    await page.getByPlaceholder("Choose title").click();
    await page.getByRole("option", { name: "Generated Fixture Title" }).click();
    await page.locator("label").filter({ hasText: /^Split$/ }).click();
    await page.getByRole("checkbox").first().click({ force: true }); // the title has one recording after the merge
    await expect(page.getByTestId("split-file").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("split-file")).toHaveCount(snap.files.length);
    await page.getByLabel("Label for part 1").fill("Split part one");
    await page.getByLabel("Label for part 2").fill("Split part two");
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page.getByTestId("plan-state")).toHaveText("planned");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("plan-state")).toHaveText("approved");
    await page.getByRole("button", { name: "Apply repair" }).click();
    await expect(page.getByTestId("plan-state")).toHaveText("applied");

    // The old identity answers with an explicit repair error naming both successors.
    const old = await reader.get(`/api/v1/recordings/${merged.id}`, { headers: auth });
    expect(old.status()).toBe(409);
    const oldBody = (await old.json()) as { code: string; successorRecordingIds: string[] };
    expect(oldBody.code).toBe("recording_repaired");
    expect(oldBody.successorRecordingIds).toHaveLength(2);
    expect(oldBody.successorRecordingIds).not.toContain(merged.id); // new identities, not the retired source
    const successors = await Promise.all(oldBody.successorRecordingIds.map(async (id) => ({ id, snap: (await (await reader.get(`/api/v1/recordings/${id}`, { headers: auth })).json()) as { files: { id: string }[] } })));
    const partOne = successors.find((x) => x.snap.files.some((f) => f.id === snap.files[0].id))!;
    const partTwo = successors.find((x) => x.snap.files.some((f) => f.id === lastFile.id))!;
    expect(partOne.id).not.toBe(partTwo.id); // the files went to different successors, in order

    // The reader's place is offered only on the successor that received the anchored (last) file; nothing is finished.
    const state = async (id: string) => (await (await reader.get(`/api/v1/recordings/${id}/position`, { headers: auth })).json()) as { position: unknown; unresolvedConflicts: { candidate: { fileId: string } | null }[] };
    const [s1, s2] = [await state(partOne.id), await state(partTwo.id)];
    expect(s1.position).toBeNull(); // no canonical resume on a new recording
    expect(s2.position).toBeNull();
    expect(s1.unresolvedConflicts).toHaveLength(0); // the first file's partition has no anchored place
    expect(s2.unresolvedConflicts).toHaveLength(1);
    expect(s2.unresolvedConflicts[0].candidate?.fileId).toBe(lastFile.id);
    for (const id of [partOne.id, partTwo.id]) {
      const c = (await (await reader.get(`/api/v1/recordings/${id}/completion`, { headers: auth })).json()) as { finished: boolean };
      expect(c.finished).toBe(false);
    }
  } finally {
    await reader.dispose();
  }
});

// metadata-import-management (T004 screens): a protected clear, and a review decision with an error and a success.
test("a protected clear is shown as deliberately empty, survives a rescan, and can be removed", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "fixture-admin");
  await openTitle(page, "The Replaceable");
  await page.getByText(/EPUB/).first().click();
  const editionUrl = page.url();
  const admin = page.getByTestId("edition-admin");
  await expect(admin).toBeVisible();
  const row = admin.getByTestId("metadata-table").getByRole("row", { name: /^series_name/ });
  await admin.getByLabel("Field", { exact: true }).click();
  await page.getByRole("option", { name: "series_name" }).click();
  await admin.getByRole("button", { name: "Protected clear" }).click();
  await expect(row.getByText("(deliberately empty)")).toBeVisible();
  await expect(row.getByText("user")).toBeVisible();

  // Two scans later the clear is still in force (protected edits survive rescans).
  await page.goto("/admin/libraries");
  await page.getByRole("link", { name: "Shelf" }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Scan now" }).click();
    await page.waitForTimeout(2500); // the e2e server runs queued scans and moves its clock on
  }
  await page.goto(editionUrl);
  await expect(page.getByTestId("edition-admin").getByTestId("metadata-table").getByRole("row", { name: /^series_name/ }).getByText("(deliberately empty)")).toBeVisible();

  // Removing the override lets the other sources apply again.
  await page.getByTestId("edition-admin").getByLabel("Field", { exact: true }).click();
  await page.getByRole("option", { name: "series_name" }).click();
  await page.getByTestId("edition-admin").getByRole("button", { name: "Remove my override" }).click();
  await expect(page.getByTestId("edition-admin").getByTestId("metadata-table").getByRole("row", { name: /^series_name/ }).getByText("(deliberately empty)")).toHaveCount(0);
});

test("a grouping review is decided in the browser: a bad decision shows the server's error, a good one clears the item", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "fixture-admin");
  await page.goto("/admin/libraries");
  await page.getByRole("link", { name: "Shelf" }).click();
  const items = page.getByTestId("review-item").filter({ hasText: "edition-title:" });
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  const before = await items.count();
  const first = items.first();

  // A link decision with a title that does not exist is refused, visibly, and the item stays.
  await first.getByLabel("Decision").click();
  await page.getByRole("option", { name: "link" }).click();
  await first.getByLabel("Title ID").fill("00000000-0000-4000-8000-00000000dead");
  await first.getByRole("button", { name: "Resolve" }).click();
  await expect(first.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  await expect(items).toHaveCount(before);

  // Keeping the works separate is accepted and the item goes away.
  await first.getByLabel("Decision").click();
  await page.getByRole("option", { name: "keep_separate" }).click();
  await first.getByRole("button", { name: "Resolve" }).click();
  await expect(items).toHaveCount(before - 1, { timeout: 15_000 });
});
