import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "./App";
import { AuthProvider } from "./auth/session";

const user = { id: "u1", username: "ada", displayName: "Ada", isAdmin: false, active: true };
const session = { user, session: {}, csrfToken: "c".repeat(40) };
const title = { id: "t1", title: "Second Volume", authors: ["Ada Author"], series: [], languages: [], editionCount: 1, recordingCount: 0 };

type Handler = (url: string, init: RequestInit) => { status?: number; body?: unknown };
let calls: { url: string; init: RequestInit }[] = [];

function mockApi(h: Handler) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = h(url, init);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body ?? null } as Response;
  });
}

function mount(path: string) {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider><QueryClientProvider client={qc}><AuthProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></AuthProvider></QueryClientProvider></MantineProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // jsdom lacks ResizeObserver, which Mantine select dropdowns use.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(cleanup);

test("an unauthenticated visitor is sent to sign in", async () => {
  mockApi(() => ({ status: 401, body: { code: "unauthenticated" } }));
  mount("/");
  expect(await screen.findByRole("heading", { name: "Sign in to Litara" })).toBeTruthy();
});

test("signing in shows the library and sends the CSRF token on writes only", async () => {
  let signedIn = false;
  mockApi((url) => {
    if (url.endsWith("/auth/web/session")) return signedIn ? { body: session } : { status: 401, body: {} };
    if (url.endsWith("/auth/web/login")) { signedIn = true; return { body: session }; }
    if (url.includes("/titles")) return { body: { items: [title], total: 1, page: 0, size: 24 } };
    if (url.includes("/libraries")) return { body: { items: [], total: 0, page: 0, size: 200 } };
    if (url.includes("/shelves")) return { body: { items: [], total: 0, page: 0, size: 200 } };
    return { status: 404, body: { code: "not_found" } };
  });
  mount("/");
  fireEvent.change(await screen.findByLabelText(/Username/), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Second Volume")).toBeTruthy();
  expect(screen.getByTestId("whoami").textContent).toBe("Ada");

  const login = calls.find((c) => c.url.endsWith("/auth/web/login"))!;
  expect(JSON.parse(login.init.body as string)).toEqual({ username: "ada", password: "pw", deviceName: "Web browser" });
  const reads = calls.filter((c) => c.init.method === "GET");
  expect(reads.length).toBeGreaterThan(0);
  for (const r of reads) expect((r.init.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
  expect(calls.every((c) => c.init.credentials === "same-origin")).toBe(true);
});

test("a rejected password is reported without leaving the form", async () => {
  mockApi((url) => url.endsWith("/auth/web/login") ? { status: 401, body: { code: "invalid_credentials" } } : { status: 401, body: {} });
  mount("/login");
  fireEvent.change(await screen.findByLabelText(/Username/), { target: { value: "ada" } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "bad" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Incorrect username or password."));
  expect((screen.getByLabelText(/Password/) as HTMLInputElement).value).toBe("");
});

test("marking an edition finished sends the revision, file and version with a CSRF token", async () => {
  const edition = {
    id: "e1", titleId: "t1", libraryId: "l1", revision: "0", label: "", language: null,
    file: { id: "f1", contentVersion: "v1", format: "epub", mimeType: "application/epub+zip", sizeBytes: 2048, availability: "available", contentPath: "/api/v1/files/f1/versions/v1/content" },
    readiness: "ready", issues: [], completion: { revision: "4", finished: false, changedAt: null },
    capabilities: Object.fromEntries(["read", "download", "resume", "textSelection", "textHighlight", "pageNote", "bookmark"].map((k) => [k, { state: "supported", issues: [] }])),
  };
  mockApi((url, init) => {
    if (url.endsWith("/auth/web/session")) return { body: session };
    if (url.endsWith("/editions/e1") && init.method === "GET") return { body: edition };
    if (url.endsWith("/completion")) return { body: { revision: "5", finished: true, changedAt: "2026-11-14T00:00:00Z" } };
    return { status: 404, body: {} };
  });
  mount("/editions/e1");
  fireEvent.click(await screen.findByRole("button", { name: "Mark finished" }));
  await waitFor(() => expect(calls.some((c) => c.url.endsWith("/completion"))).toBe(true));
  const put = calls.find((c) => c.url.endsWith("/completion"))!;
  expect((put.init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("c".repeat(40));
  const body = JSON.parse(put.init.body as string);
  expect(body).toMatchObject({ baseRevision: "4", fileId: "f1", contentVersion: "v1", event: "manual_finish" });
  expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(screen.getByRole("button", { name: "Read" }).hasAttribute("disabled")).toBe(true);
});
