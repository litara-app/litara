import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "synthetic-fixture-password";

async function signIn(page: Page, user = "fixture-user-a") {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill(user);
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();
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
    await page.reload();
    await expect(page.getByTestId("total")).toHaveText("3:00");
    expect(await secs(page)).toBeGreaterThanOrEqual(91); // resumed at the saved place, not at the start
    await expect(page.getByTestId("play")).toHaveText("Play"); // never auto-plays
  }
});

test("seeking and skipping cross file boundaries while playing", async ({ page }) => {
  await signIn(page);
  const id = await recordingId(page);
  await page.goto(`/listen/${id}`);
  await page.getByTestId("chapter").first().click();
  await expect.poll(() => secs(page)).toBeLessThan(5);
  if ((await startPlayback(page)) === "unsupported") return;
  await page.getByRole("button", { name: "Forward 30 seconds" }).click();
  await page.getByRole("button", { name: "Forward 30 seconds" }).click();
  await expect.poll(() => secs(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(60); // now in the second file
  const before = await secs(page);
  await expect.poll(() => secs(page), { timeout: 10_000 }).toBeGreaterThan(before); // and still playing
  await page.getByRole("button", { name: "Back 30 seconds" }).click();
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
  const finish = page.getByRole("button", { name: /Mark (un)?finished/ });
  const was = (await finish.innerText()).includes("unfinished");
  await finish.click();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/recordings/${id}/completion`)).json()).finished, { timeout: 15_000 }).toBe(!was);
  await page.getByRole("button", { name: /Mark (un)?finished/ }).click();
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
  const finish = page.getByRole("button", { name: /Mark (un)?finished/ });
  if ((await finish.innerText()).includes("unfinished")) { // start unfinished (shared server)
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
  await page.getByRole("button", { name: /Mark unfinished/ }).click();
  await expect.poll(async () => (await completion()).finished, { timeout: 15_000 }).toBe(false);
});
