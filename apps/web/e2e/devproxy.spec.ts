import { expect, test } from "@playwright/test";

// same-origin-fallback, development proxy: the Vite dev server forwards the API to the real server and keeps the
// browser same-origin. The session cookie stays HttpOnly and scoped to the dev origin, the CSRF token travels
// through the proxy unchanged, and a mutation without it is refused by the server (ADR-0037, ADR-0069).
// The reader origin is not served by the dev server (it needs the real server), so the reader is out of scope here.

const PASSWORD = "synthetic-fixture-password";
const DEV = "http://127.0.0.1:5174";

test("through the dev proxy: sign in works, the cookie is HttpOnly, a mutation needs the CSRF token", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill("fixture-user-a");
  await page.getByLabel(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeVisible();

  const cookies = await context.cookies();
  expect(cookies.length).toBeGreaterThan(0);
  for (const c of cookies) {
    expect(c.httpOnly, `${c.name} must be HttpOnly`).toBe(true);
    expect(c.domain).toBe("127.0.0.1"); // scoped to the dev origin, not the proxied server
  }
  expect(await page.evaluate(() => document.cookie)).toBe("");

  const session = (await (await page.request.get("/api/v1/auth/web/session")).json()) as { csrfToken: string };
  expect(session.csrfToken).toBeTruthy();
  const sid = crypto.randomUUID();
  const body = { operationId: crypto.randomUUID(), baseRevision: "0", capturedAt: new Date().toISOString(), data: { name: "Dev proxy shelf", visibility: "private", kind: "manual", filter: null } };

  // Missing and wrong tokens are refused by the real server, through the proxy.
  for (const headers of [{ Origin: DEV }, { Origin: DEV, "X-CSRF-Token": "wrong-token" }]) {
    const r = await page.request.put(`/api/v1/shelves/${sid}`, { headers, data: body });
    expect(r.status(), JSON.stringify(headers)).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe("csrf_failed");
  }
  // The right token passes through unchanged and the write succeeds.
  const ok = await page.request.put(`/api/v1/shelves/${sid}`, { headers: { Origin: DEV, "X-CSRF-Token": session.csrfToken }, data: body });
  expect(ok.status(), await ok.text()).toBe(200);

  // The app, running through the same proxy, shows the shelf the proxied write created.
  await page.goto("/shelves");
  await expect(page.getByRole("heading", { name: /Shelves/ }).first()).toBeVisible();
  await expect(page.getByText("Dev proxy shelf")).toBeVisible({ timeout: 15_000 });

  // Clean up.
  const cur = (await (await page.request.get(`/api/v1/shelves/${sid}`)).json()) as { revision: string };
  const del = await page.request.delete(`/api/v1/shelves/${sid}`, { headers: { Origin: DEV, "X-CSRF-Token": session.csrfToken }, data: { operationId: crypto.randomUUID(), baseRevision: cur.revision, capturedAt: new Date().toISOString() } });
  expect(del.status()).toBe(200);
});

test("the dev server answers its own pages and forwards unknown API paths as the server's 404, not HTML", async ({ request }) => {
  const page = await request.get("/titles/00000000-0000-4000-8000-000000000001");
  expect(page.status()).toBe(200);
  expect(page.headers()["content-type"]).toContain("text/html");
  const api = await request.get("/api/v1/definitely-missing");
  expect(api.status()).toBe(404);
  expect(api.headers()["content-type"] ?? "").not.toContain("text/html");
  expect((await request.get("/healthz")).status()).toBe(200); // proxied to the real server
});
