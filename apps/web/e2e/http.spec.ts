import { expect, test, type APIResponse } from "@playwright/test";

// same-origin-fallback, real HTTP: the single page app answers navigation only. API, asset, reader and media
// URLs never receive index.html, an unknown path outside the app's routes is a plain 404, and a range request
// for a book or recording gets bytes, not HTML (ADR-0069, ADR-0071).

const PASSWORD = "synthetic-fixture-password";
const READER = "http://localhost:8092";

const isHtml = (r: APIResponse) => /text\/html/i.test(r.headers()["content-type"] ?? "");

test("navigation falls back to the app; nothing else does", async ({ request, browserName }) => {
  test.skip(browserName !== "chromium", "plain HTTP checks; one browser is enough");

  // A nested app route loads the single page (a deep link or a reload).
  for (const route of ["/titles/00000000-0000-4000-8000-000000000001", "/read/00000000-0000-4000-8000-000000000002", "/admin/libraries/x/y", "/shelves"]) {
    const r = await request.get(route);
    expect(r.status(), route).toBe(200);
    expect(isHtml(r), route).toBe(true);
    expect(await r.text()).toContain('id="root"');
  }

  // Unknown API, asset and other paths are 404s that are not HTML.
  for (const url of ["/api/v1/definitely-missing", "/api/v2/anything", "/assets/does-not-exist.js", "/healthz/extra", "/reader/frame.html", "/nope", "/vendor/x.js"]) {
    const r = await request.get(url);
    expect(r.status(), url).toBe(404);
    expect(isHtml(r), `${url} must not return index.html`).toBe(false);
  }
  // A path that merely starts like an app route is not an app route.
  const lookalike = await request.get("/titlesx/1");
  expect(lookalike.status()).toBe(404);
  expect(isHtml(lookalike)).toBe(false);

  // The app origin never serves the reader's files, and the reader origin serves nothing else.
  for (const url of [`${READER}/does-not-exist.js`, `${READER}/api/v1/titles`, `${READER}/titles/1`, `${READER}/vendor/foliate-js/missing.js`, `${READER}/login`]) {
    const r = await request.get(url);
    expect(r.status(), url).toBe(404);
    expect(isHtml(r), `${url} must not return index.html`).toBe(false);
  }
  expect((await request.get(`${READER}/frame.html`)).status()).toBe(200); // its own document is served
});

test("a range request for a book or a recording returns bytes, never HTML", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "plain HTTP checks; one browser is enough");
  await page.goto("/login");
  await page.getByLabel(/Username/).fill("fixture-user-a");
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeAttached(); // the account name is hidden at phone width

  // An ebook file through the content endpoint.
  const titles = (await (await page.request.get("/api/v1/titles?size=200")).json()).items as { id: string; title: string }[];
  const novel = titles.find((t) => t.title === "The Browser Novel")!;
  const ed = ((await (await page.request.get(`/api/v1/editions?titleId=${novel.id}`)).json()).items as { file: { contentPath: string; sizeBytes: number } }[])[0];
  const whole = await page.request.get(ed.file.contentPath);
  expect(whole.status()).toBe(200);
  expect(isHtml(whole)).toBe(false);
  const first = await page.request.get(ed.file.contentPath, { headers: { Range: "bytes=0-3" } });
  expect(first.status()).toBe(206);
  expect(first.headers()["content-range"]).toMatch(new RegExp(`^bytes 0-3/${ed.file.sizeBytes}$`));
  expect([...(await first.body())]).toEqual([0x50, 0x4b, 0x03, 0x04]); // "PK": the zip signature, not "<!doc"
  const tail = await page.request.get(ed.file.contentPath, { headers: { Range: "bytes=-8" } });
  expect(tail.status()).toBe(206);
  expect((await tail.body()).length).toBe(8);
  const beyond = await page.request.get(ed.file.contentPath, { headers: { Range: `bytes=${ed.file.sizeBytes + 100}-` } });
  expect(beyond.status()).toBe(416);
  expect(isHtml(beyond)).toBe(false);

  // A recording's audio file.
  const rec = ((await (await page.request.get("/api/v1/recordings?size=200")).json()).items as { id: string; durationMs: number | null }[]).find((r) => r.durationMs === 180_000)!;
  const snap = (await (await page.request.get(`/api/v1/recordings/${rec.id}`)).json()) as { files: { contentPath: string; sizeBytes: number }[] };
  const audio = await page.request.get(snap.files[0].contentPath, { headers: { Range: "bytes=0-1023" } });
  expect(audio.status()).toBe(206);
  expect(isHtml(audio)).toBe(false);
  expect(audio.headers()["accept-ranges"]).toBe("bytes");
  expect((await audio.body()).length).toBe(1024);
  const head = await page.request.head(snap.files[0].contentPath);
  expect(head.status()).toBe(200);
  expect(isHtml(head)).toBe(false);

  // Media needs the session: without it the URL is a 401, still not HTML.
  const anon = await page.context().browser()!.newContext({ baseURL: "http://127.0.0.1:8091" });
  const denied = await anon.request.get(ed.file.contentPath, { headers: { Range: "bytes=0-3" } });
  expect(denied.status()).toBe(401);
  expect(isHtml(denied)).toBe(false);
  await anon.close();
});
