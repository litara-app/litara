import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "synthetic-fixture-password";

async function signIn(page: Page, user = "fixture-user-a") {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeAttached(); // the account name is hidden at phone width
}

async function recordingId(page: Page): Promise<string> {
  const list = await (await page.request.get("/api/v1/recordings?size=200")).json();
  return list.items.find((r: { durationMs: number | null }) => r.durationMs === 180_000).id;
}

const secs = async (page: Page) => {
  const [m, s] = (await page.getByTestId("elapsed").innerText()).split(":").slice(-2).map(Number);
  return m * 60 + s;
};

/** Codec support differs per browser: either playback works or the page says so explicitly. */
async function startPlayback(page: Page): Promise<"playing" | "unsupported"> {
  await page.getByTestId("play").click();
  const start = await secs(page);
  const result = await Promise.race([
    expect.poll(() => secs(page), { timeout: 15_000 }).toBeGreaterThan(start).then(() => "playing" as const),
    page.getByTestId("player-error").waitFor({ timeout: 15_000 }).then(() => "unsupported" as const),
  ]);
  if (result === "unsupported") await expect(page.getByTestId("player-error")).toContainText(/cannot play|could not be played|blocked/);
  return result;
}

/** Opens the player's actions menu and returns its finish or unfinish item. */
async function finishItem(page: Page) {
  await page.getByRole("button", { name: "Recording actions" }).click();
  return page.getByRole("menuitem", { name: /^Mark (un)?finished$/ });
}

async function savedPosition(page: Page, id: string) {
  return (await (await page.request.get(`/api/v1/recordings/${id}/position`)).json()) as { revision: string; position: { fileId: string; offsetMs: number } | null };
}

test.describe.configure({ mode: "serial" });

test("the player shows the recording, plays real audio and saves the place on pause", async ({ page, browserName }) => {
  await signIn(page);
  const id = await recordingId(page);
  await page.goto(`/listen/${id}`);
  await expect(page.getByTestId("listen-title")).toHaveText("Generated Fixture Title");
  await expect(page.getByTestId("total")).toHaveText("3:00");
  await expect(page.getByTestId("chapter")).toHaveCount(4); // the embedded chapters, including one spanning two files
  await expect(page.getByTestId("chapter").first()).toContainText("Opening");

  await page.getByTestId("chapter").nth(2).click(); // "Middle" starts 30 s into the second file (1:30 overall)
  await expect.poll(() => secs(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(90);
  const outcome = await startPlayback(page);
  test.info().annotations.push({ type: "codec", description: `${browserName}: mp3 ${outcome}` });
  if (outcome === "playing") {
    await page.getByTestId("play").click(); // pause
    await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 15_000 });
    await expect.poll(async () => (await savedPosition(page, id)).position?.offsetMs ?? 0, { timeout: 15_000 }).toBeGreaterThan(30_000); // a file anchor past the chapter start, not a percentage
    // The direct link leaves you on the book's page, so open the link again: a reload there does not reopen the player.
    await page.goto(`/listen/${id}`);
    await expect(page.getByTestId("total")).toHaveText("3:00");
    expect(await secs(page)).toBeGreaterThanOrEqual(91); // resumed at the saved place, not at the start
    await expect(page.getByTestId("play")).toHaveAccessibleName("Play"); // never auto-plays
  }
});

test("seeking and skipping cross file boundaries while playing", async ({ page }) => {
  await signIn(page);
  const id = await recordingId(page);
  await page.goto(`/listen/${id}`);
  await page.getByTestId("chapter").first().click();
  await expect.poll(() => secs(page)).toBeLessThan(5);
  if ((await startPlayback(page)) === "unsupported") return;
  await page.getByTestId("deck").getByRole("button", { name: "Forward 30 seconds" }).click();
  await page.getByTestId("deck").getByRole("button", { name: "Forward 30 seconds" }).click();
  await expect.poll(() => secs(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(60); // now in the second file
  const before = await secs(page);
  await expect.poll(() => secs(page), { timeout: 10_000 }).toBeGreaterThan(before); // and still playing
  await page.getByTestId("deck").getByRole("button", { name: "Back 30 seconds" }).click();
  await expect.poll(() => secs(page), { timeout: 10_000 }).toBeLessThan(before);
  await page.getByTestId("play").click();
});

test("a place saved while the server is unreachable is kept and sent later", async ({ page }) => {
  await signIn(page);
  const id = await recordingId(page);
  await page.goto(`/listen/${id}`);
  await page.getByTestId("chapter").nth(3).click(); // "Finale" in the third file
  await expect.poll(() => secs(page)).toBeGreaterThanOrEqual(160);
  await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 15_000 }); // the jump itself has been written
  const before = await savedPosition(page, id);
  const pattern = "**/api/v1/recordings/*/position";
  await page.route(pattern, (r) => (r.request().method() === "PUT" ? r.abort("connectionrefused") : r.continue()));
  if ((await startPlayback(page)) === "unsupported") { await page.unroute(pattern); return; }
  await page.getByTestId("play").click();
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 15_000 });
  expect((await savedPosition(page, id)).revision).toBe(before.revision); // not claimed as saved
  await page.unroute(pattern);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => Number((await savedPosition(page, id)).revision), { timeout: 20_000 }).toBeGreaterThan(Number(before.revision));
  await expect(page.getByTestId("offline-banner")).toHaveCount(0, { timeout: 20_000 });
});

test("finishing a recording is recorded as a completion, and can be undone", async ({ page }) => {
  await signIn(page);
  const id = await recordingId(page);
  await page.goto(`/listen/${id}`);
  const finish = await finishItem(page);
  const was = (await finish.innerText()).includes("unfinished");
  await finish.click();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/recordings/${id}/completion`)).json()).finished, { timeout: 15_000 }).toBe(!was);
  await (await finishItem(page)).click();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/recordings/${id}/completion`)).json()).finished, { timeout: 15_000 }).toBe(was);
});

test("an unreadable recording is explained instead of offering broken controls", async ({ page }) => {
  await signIn(page);
  const list = await (await page.request.get("/api/v1/recordings?size=200")).json();
  const incomplete = list.items.find((r: { readiness: string }) => r.readiness === "incomplete");
  await page.goto(`/listen/${incomplete.id}`);
  await expect(page.getByText("This recording cannot be played yet")).toBeVisible();
  await expect(page.getByTestId("play")).toBeDisabled();
});

test("playing to the natural end records a completion; nothing is finished by merely reaching a chapter", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const id = await recordingId(page);
  const completion = async () => (await (await page.request.get(`/api/v1/recordings/${id}/completion`)).json()) as { finished: boolean; revision: string };
  await page.goto(`/listen/${id}`);
  const finish = await finishItem(page);
  if (!(await finish.innerText()).includes("unfinished")) await page.keyboard.press("Escape");
  else { // start unfinished (shared server)
    await finish.click();
    await expect.poll(async () => (await completion()).finished, { timeout: 15_000 }).toBe(false);
  }
  const historyBefore = ((await (await page.request.get("/api/v1/recordings/" + id)).json()) as { titleId: string }).titleId;
  const events = async () => ((await (await page.request.get(`/api/v1/titles/${historyBefore}/history`)).json()) as { items: { event?: string; source?: string }[] }).items;
  const countBefore = (await events()).length;

  await page.getByTestId("chapter").nth(3).click(); // "Finale", about 160 s of 180 s
  await expect.poll(() => secs(page)).toBeGreaterThanOrEqual(160);
  expect((await completion()).finished).toBe(false); // reaching the last chapter finishes nothing

  // Play on from the start of the finale (about 20 s before the end) and let it run out.
  if ((await startPlayback(page)) === "unsupported") {
    test.info().annotations.push({ type: "codec", description: `${browserName}: mp3 unsupported, natural end not driven` });
    return;
  }
  await expect.poll(async () => (await completion()).finished, { timeout: 60_000, message: "the natural end must record a completion" }).toBe(true);
  const after = await events();
  expect(after.length).toBe(countBefore + 1); // exactly one new history entry
  expect(JSON.stringify(after)).toContain("natural_end");

  // Undo so the shared server is as found.
  await (await finishItem(page)).click();
  await expect.poll(async () => (await completion()).finished, { timeout: 15_000 }).toBe(false);
});

// Audio position conflict in the browser: another device saves a newer place while this tab still holds the older
// revision. The tab's next save is refused, the banner names the other device, and both choices work. No playback
// is needed, so this runs in every browser.
test("a place saved from another device is offered, and both choices resolve the conflict", async ({ page, playwright }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const id = await recordingId(page);
  const ORIGIN = "http://127.0.0.1:8091";
  const device = await playwright.request.newContext({ baseURL: ORIGIN });
  const login = await device.post("/api/v1/auth/native/login", { data: { username: "fixture-user-a", password: PASSWORD, deviceName: "kitchen-tablet" } });
  expect(login.status()).toBe(200);
  const auth = { Authorization: `Bearer ${((await login.json()) as { accessToken: string }).accessToken}` };
  const snap = (await (await device.get(`/api/v1/recordings/${id}`, { headers: auth })).json()) as { layoutRevision: string; files: { id: string; contentVersion: string; durationMs: number }[] };
  const current = async () => (await (await device.get(`/api/v1/recordings/${id}/position`, { headers: auth })).json()) as { revision: string; position: { fileId: string; offsetMs: number; deviceName: string } | null; unresolvedConflicts: unknown[] };
  const otherDeviceSaves = async (fileIndex: number, offsetMs: number) => {
    const r = await device.put(`/api/v1/recordings/${id}/position`, {
      headers: auth,
      data: { operationId: crypto.randomUUID(), baseRevision: (await current()).revision, layoutRevision: snap.layoutRevision,
        position: { fileId: snap.files[fileIndex].id, contentVersion: snap.files[fileIndex].contentVersion, offsetMs, capturedAt: new Date().toISOString() } },
    });
    expect(r.status(), await r.text()).toBe(200);
  };
  try {
    await page.goto(`/listen/${id}`);
    await page.getByTestId("chapter").first().click(); // this tab saves its own place first
    await expect(page.getByTestId("save-status")).toHaveText("position saved", { timeout: 15_000 });

    // The other device saves 20 s into the second file (80 s overall) while this tab is unaware.
    await otherDeviceSaves(1, 20_000);
    await page.getByTestId("chapter").nth(3).click(); // "Finale": this tab's save carries the old revision
    await expect(page.getByText("Your place changed on another device")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/kitchen-tablet/)).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveText("paused"); // nothing more is written until the choice

    // Choice 1: go to the other device's place.
    await page.getByRole("button", { name: "Go to that place" }).click();
    await expect(page.getByText("Your place changed on another device")).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => secs(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(79);
    expect(await secs(page)).toBeLessThanOrEqual(82);
    expect((await current()).position?.deviceName).toBe("kitchen-tablet");

    // Choice 2: a second conflict, resolved by keeping this tab's own place.
    await otherDeviceSaves(0, 10_000);
    await page.getByTestId("chapter").nth(3).click();
    await expect(page.getByText("Your place changed on another device")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Keep my place" }).click();
    await expect(page.getByText("Your place changed on another device")).toHaveCount(0, { timeout: 15_000 });
    const final = await current();
    const idx = snap.files.findIndex((f) => f.id === final.position?.fileId);
    const whole = snap.files.slice(0, idx).reduce((n, f) => n + f.durationMs, 0) + (final.position?.offsetMs ?? 0);
    expect(whole).toBeGreaterThanOrEqual(160_000); // this tab's jump to the finale, not the other device's 10 s
    expect(final.unresolvedConflicts).toHaveLength(0);
  } finally {
    await device.dispose();
  }
});
