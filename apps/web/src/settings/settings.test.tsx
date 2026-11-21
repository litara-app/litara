
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "../App";
import { AuthProvider } from "../auth/session";
import { PendingProvider } from "../pending/PendingProvider";
import { newSecret } from "../api/t006";

const admin = { id: "a1", username: "root", displayName: "Root", isAdmin: true, active: true };
const person = { id: "u1", username: "ada", displayName: "Ada", isAdmin: false, active: true };
const csrf = "c".repeat(40);

type Call = { method: string; url: string; body: any };
let calls: Call[] = [];
type Handler = (c: Call) => { status?: number; body?: unknown } | undefined;
let routes: Handler[] = [];
let who = person;

function respond(h: Handler) { routes.push(h); }
const settings = { revision: "3", opdsEnabled: true, emailEnabled: true, koreaderEnabled: true, maxAttachmentBytes: 26214400, maxDeliveriesPerUserPerHour: 10, serverSmtpAvailable: true };
const transports = { server: { available: true, revision: "2" }, personal: { available: false, revision: "0" } };
const recipient = { id: "r1", revision: "4", deleted: false, data: { name: "Reader One", address: "reader@example.invalid" } };

function install() {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call: Call = { method: init.method ?? "GET", url: url.replace("/api/v1", ""), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    let r: ReturnType<Handler>;
    for (const h of [...routes].reverse()) { r = h(call); if (r) break; }
    r ??= defaults(call);
    const status = r?.status ?? 200;
    return { ok: status < 400, status, json: async () => r?.body ?? null } as Response;
  });
}

function defaults(c: Call) {
  const u = c.url;
  if (u === "/auth/web/session") return { body: { user: who, session: {}, csrfToken: csrf } };
  if (u === "/integrations/settings") return { body: settings };
  if (u === "/delivery/transports") return { body: transports };
  if (u === "/delivery/recipients") return { body: { items: [recipient] } };
  if (u === "/integration-credentials") return { body: { items: [] } };
  if (u.startsWith("/koreader/")) return { body: { items: [], total: 0, page: 0, size: 200 } };
  if (u.startsWith("/deliveries?")) return { body: { items: [], total: 0, page: 0, size: 50 } };
  return { status: 404, body: { code: "not_found", detail: "not found" } };
}

function mount(path: string) {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><AuthProvider><PendingProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></PendingProvider></AuthProvider></QueryClientProvider>,
  );
}

async function choose(label: RegExp | string, option: RegExp | string) {
  fireEvent.click(await screen.findByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option, hidden: true }));
}

const sent = (method: string, prefix: string) => calls.filter((c) => c.method === method && (prefix.endsWith("/") || prefix === "/delivery/smtp" || prefix === "/deliveries" || prefix === "/integration-credentials" ? c.url === prefix || (prefix.endsWith("/") && c.url.startsWith(prefix)) : c.url.startsWith(prefix)));

beforeEach(() => {
  vi.unstubAllGlobals();
  routes = [];
  who = person;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  install();
});
afterEach(cleanup);

// ---- credentials -------------------------------------------------------------

test("a generated secret is 32 random bytes as base64url", () => {
  const a = newSecret(), b = newSecret();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(a).not.toBe(b);
  const bin = atob(a.replace(/-/g, "+").replace(/_/g, "/") + "=");
  expect(bin.length).toBe(32);
});

test("a new credential's password is shown once, sent once and never stored in the browser", async () => {
  let sentPassword = "";
  respond((c) => {
    if (c.method === "POST" && c.url === "/integration-credentials") {
      sentPassword = c.body.password;
      // The server returns metadata only, never the password.
      return { status: 201, body: { id: "c1", kind: c.body.kind, username: "opds-abc123", label: c.body.label, createdAt: "2026-11-16T10:00:00Z", revoked: false, lastUsedAt: null } };
    }
  });
  mount("/settings/credentials");
  fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: "Phone reader" } });
  fireEvent.click(screen.getByRole("button", { name: "Create credential" }));
  const box = await screen.findByTestId("one-time-secret");
  expect(sentPassword).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(within(box).getByTestId("secret-password").textContent).toBe(sentPassword);
  expect(within(box).getByTestId("secret-username").textContent).toBe("opds-abc123");
  const post = sent("POST", "/integration-credentials")[0];
  expect(post.body.kind).toBe("opds");
  expect(post.body.operationId).toMatch(/^[0-9a-f-]{36}$/);
  // CSRF accompanies the unsafe request through the shared client (covered in client.test.ts); nothing is persisted.
  expect(JSON.stringify({ ...localStorage })).not.toContain(sentPassword);
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(sentPassword);
  fireEvent.click(within(box).getByRole("button", { name: "I have saved it" }));
  await waitFor(() => expect(screen.queryByTestId("one-time-secret")).toBeNull());
  expect(document.body.textContent).not.toContain(sentPassword);
});

test("revoking needs a confirmation and sends a fresh operation", async () => {
  respond((c) => {
    if (c.method === "GET" && c.url === "/integration-credentials") return { body: { items: [{ id: "c9", kind: "koreader", username: "kor-xyz", label: "Kobo", createdAt: "2026-11-16T10:00:00Z", revoked: false, lastUsedAt: null }] } };
    if (c.method === "POST" && c.url === "/integration-credentials/c9/revoke") return { body: { id: "c9", kind: "koreader", username: "kor-xyz", label: "Kobo", createdAt: "x", revoked: true, lastUsedAt: null } };
  });
  mount("/settings/credentials");
  fireEvent.click(await screen.findByRole("button", { name: "Revoke Kobo" }));
  expect(sent("POST", "/integration-credentials/c9/revoke")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
  await waitFor(() => expect(sent("POST", "/integration-credentials/c9/revoke")).toHaveLength(1));
  expect(sent("POST", "/integration-credentials/c9/revoke")[0].body.operationId).toBeTruthy();
});

// ---- SMTP --------------------------------------------------------------------

const report = { revision: "5", configured: true, enabled: true, host: "smtp.example.com", port: 587, tlsMode: "starttls", username: "someone", fromAddress: "me@example.com", hasPassword: true, keyAvailable: true };

test("the stored mail password is never displayed or prefilled, and keep sends no password", async () => {
  respond((c) => { if (c.url === "/delivery/smtp" && c.method === "GET") return { body: report }; });
  respond((c) => { if (c.url === "/delivery/smtp" && c.method === "PUT") return { body: { ...report, revision: "6", port: c.body.port } }; });
  mount("/settings/email");
  const pw = (await screen.findByLabelText(/New password/)) as HTMLInputElement;
  expect(pw.value).toBe("");
  expect(screen.getByText("A password is stored. It cannot be shown.")).toBeTruthy();
  const save = screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true); // nothing changed
  fireEvent.change(screen.getByLabelText(/Port/), { target: { value: "2525" } });
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(save);
  await waitFor(() => expect(sent("PUT", "/delivery/smtp")).toHaveLength(1));
  const body = sent("PUT", "/delivery/smtp")[0].body;
  expect(body).toMatchObject({ baseRevision: "5", secretAction: "keep", password: null, port: 2525, host: "smtp.example.com", tlsMode: "starttls" });
});

test("a new password replaces, removal clears, and a username without any password cannot be saved", async () => {
  respond((c) => { if (c.url === "/delivery/smtp" && c.method === "GET") return { body: { ...report, hasPassword: false, username: "" } }; });
  respond((c) => { if (c.url === "/delivery/smtp" && c.method === "PUT") return { body: { ...report, revision: "6" } }; });
  mount("/settings/email");
  const user = await screen.findByLabelText(/Username/);
  fireEvent.change(user, { target: { value: "someone" } });
  expect(await screen.findByText(/A username needs a password/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "s3cret-value" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(sent("PUT", "/delivery/smtp")).toHaveLength(1));
  expect(sent("PUT", "/delivery/smtp")[0].body).toMatchObject({ secretAction: "replace", password: "s3cret-value", username: "someone" });
  // The field is cleared after saving; the password does not linger in the page.
  await waitFor(() => expect(document.body.innerHTML).not.toContain("s3cret-value"));
});

test("the connection test uses saved settings only and shows a sanitized result", async () => {
  respond((c) => { if (c.url === "/delivery/smtp" && c.method === "GET") return { body: report }; });
  respond((c) => { if (c.url === "/delivery/smtp/test") return { body: { success: false, code: "tls_verification_failed", detail: "The server certificate could not be verified." } }; });
  mount("/settings/email");
  const test_ = (await screen.findByRole("button", { name: "Test saved settings" })) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText(/Port/), { target: { value: "2525" } });
  await waitFor(() => expect(test_.disabled).toBe(true)); // unsaved edits: the test would not test them
  fireEvent.change(screen.getByLabelText(/Port/), { target: { value: "587" } });
  await waitFor(() => expect(test_.disabled).toBe(false));
  fireEvent.click(test_);
  const res = await screen.findByTestId("smtp-test-result");
  expect(res.textContent).toContain("could not be verified");
  expect(sent("POST", "/delivery/smtp/test")[0].body.baseRevision).toBe("5");
});

test("an unavailable encryption key is reported without hiding the settings", async () => {
  respond((c) => { if (c.url === "/delivery/smtp" && c.method === "GET") return { body: { ...report, keyAvailable: false } }; });
  mount("/settings/email");
  expect((await screen.findByRole("alert")).textContent).toContain("encryption key");
  expect((screen.getByLabelText(/Mail server host/) as HTMLInputElement).value).toBe("smtp.example.com");
});

// ---- sending -----------------------------------------------------------------

const edition = {
  id: "e1", titleId: "t1", libraryId: "l1", revision: "0", label: "EPUB", language: null,
  file: { id: "f1", contentVersion: "v1", format: "epub", mimeType: "application/epub+zip", sizeBytes: 2048, availability: "available", contentPath: "/api/v1/files/f1/versions/v1/content" },
  readiness: "ready", issues: [], completion: { revision: "0", finished: false, changedAt: null },
  capabilities: Object.fromEntries(["read", "download", "resume", "textSelection", "textHighlight", "pageNote", "bookmark"].map((k) => [k, { state: "supported", issues: [] }])),
};

function editionRoutes() {
  respond((c) => { if (c.url === "/editions/e1") return { body: edition }; });
  respond((c) => { if (c.url === "/editions/e1/koreader-position") return { body: { revision: "0", fileId: "f1", contentVersion: "v1", source: "koreader", position: null } }; });
}

const delivery = (over: object = {}) => ({ id: "d1", revision: "0", fileId: "f1", contentVersion: "v1", recipientId: "r1", recipientName: "Reader One", recipientAddress: "reader@example.invalid",
  transport: "server", state: "queued", attempts: 0, createdAt: "2026-11-16T10:00:00Z", updatedAt: "2026-11-16T10:00:00Z", code: null, resendOf: null, ...over });

test("sending needs an explicit recipient and transport, names the exact file and reports status honestly", async () => {
  editionRoutes();
  let state = "queued";
  respond((c) => { if (c.method === "POST" && c.url === "/deliveries") return { status: 202, body: delivery() }; });
  respond((c) => { if (c.method === "GET" && c.url === "/deliveries/d1") return { body: delivery({ state, code: state === "accepted" ? "smtp_accepted" : null }) }; });
  mount("/editions/e1");
  const send = (await screen.findByRole("button", { name: "Send file" })) as HTMLButtonElement;
  expect(send.disabled).toBe(true); // nothing is preselected, even with a single recipient and transport
  await choose("Recipient", /Reader One/);
  expect(send.disabled).toBe(true);
  // The unavailable personal transport cannot be chosen; there is no silent fallback.
  fireEvent.click(screen.getByRole("combobox", { name: "Send through" }));
  expect((await screen.findByRole("option", { name: "My own mail account", hidden: true })).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(await screen.findByRole("option", { name: "Server mail", hidden: true }));
  await waitFor(() => expect(send.disabled).toBe(false));
  fireEvent.click(send);
  await waitFor(() => expect(sent("POST", "/deliveries")).toHaveLength(1));
  expect(sent("POST", "/deliveries")[0].body).toMatchObject({
    fileId: "f1", contentVersion: "v1", recipientId: "r1", recipientRevision: "4", transport: "server", transportRevision: "2", resendOf: null, acknowledgePossibleDuplicate: false,
  });
  expect((await screen.findByTestId("send-status")).textContent).toContain("Queued");
  state = "accepted";
  expect((await screen.findByText(/Accepted by the mail server/, undefined, { timeout: 4000 })).textContent).not.toMatch(/delivered/i);
});

test("an identical retry after a failed request reuses the operation ID", async () => {
  editionRoutes();
  let n = 0;
  respond((c) => { if (c.method === "POST" && c.url === "/deliveries") { n += 1; return n === 1 ? { status: 503, body: { code: "temporarily_unavailable", detail: "try again" } } : { status: 202, body: delivery() }; } });
  mount("/editions/e1");
  await choose("Recipient", /Reader One/);
  await choose("Send through", "Server mail");
  const send = screen.getByRole("button", { name: "Send file" });
  fireEvent.click(send);
  await screen.findByRole("alert");
  fireEvent.click(send);
  await waitFor(() => expect(sent("POST", "/deliveries")).toHaveLength(2));
  const [a, b] = sent("POST", "/deliveries");
  expect(a.body.operationId).toBe(b.body.operationId);
});

test("a file over the attachment limit cannot be sent", async () => {
  respond((c) => { if (c.url === "/integrations/settings") return { body: { ...settings, maxAttachmentBytes: 1000 } }; });
  editionRoutes();
  mount("/editions/e1");
  expect((await screen.findByText(/larger than the/)).textContent).toContain("attachment limit");
  await choose("Recipient", /Reader One/);
  await choose("Send through", "Server mail");
  expect((screen.getByRole("button", { name: "Send file" }) as HTMLButtonElement).disabled).toBe(true);
});

test("no send control appears when email is not enabled", async () => {
  respond((c) => { if (c.url === "/integrations/settings") return { body: { ...settings, emailEnabled: false } }; });
  editionRoutes();
  mount("/editions/e1");
  await screen.findByRole("heading", { name: "EPUB" });
  await waitFor(() => expect(sent("GET", "/delivery/transports").length).toBeGreaterThan(0));
  expect(screen.queryByText("Send by email")).toBeNull();
});

test("the KOReader position is a separate, text-only source with its own label", async () => {
  respond((c) => { if (c.url === "/editions/e1") return { body: edition }; });
  respond((c) => { if (c.url === "/editions/e1/koreader-position") return { body: { revision: "2", fileId: "f1", contentVersion: "v1", source: "koreader", position: { document: "a".repeat(32), progress: "<img src=x onerror=alert(1)>", percentage: 0.42, device: "Kobo", deviceId: null, timestamp: 1790000000 } } }; });
  mount("/editions/e1");
  const card = await screen.findByTestId("ko-position");
  expect(card.textContent).toContain("<img src=x onerror=alert(1)>"); // shown literally
  expect(card.querySelector("img")).toBeNull();
  expect(card.textContent).toContain("42.0%");
  expect(screen.getAllByText("KOReader position").length).toBeGreaterThan(0);
  expect(card.textContent).toContain("separate");
});

test("binding a KOReader document sends the exact file and a new binding at revision zero", async () => {
  editionRoutes();
  respond((c) => { if (c.url === "/integration-credentials") return { body: { items: [{ id: "k1", kind: "koreader", username: "kor-1", label: "Kobo", createdAt: "x", revoked: false, lastUsedAt: null }] } }; });
  respond((c) => { if (c.method === "PUT" && c.url.startsWith("/koreader/bindings/")) return { body: { id: "b1", revision: "1", credentialId: "k1", document: "b".repeat(32), fileId: "f1", contentVersion: "v1", deleted: false } }; });
  mount("/editions/e1");
  await choose("Device", "Kobo");
  const bind = (await screen.findByRole("button", { name: "Bind" })) as HTMLButtonElement;
  fireEvent.change(screen.getByLabelText("Document fingerprint"), { target: { value: "not-hex" } });
  expect(bind.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Document fingerprint"), { target: { value: "B".repeat(32) } });
  await waitFor(() => expect(bind.disabled).toBe(false));
  fireEvent.click(bind);
  await waitFor(() => expect(sent("PUT", "/koreader/bindings/")).toHaveLength(1));
  expect(sent("PUT", "/koreader/bindings/")[0].body).toMatchObject({ baseRevision: "0", credentialId: "k1", document: "b".repeat(32), fileId: "f1", contentVersion: "v1" });
});

// ---- history -----------------------------------------------------------------

test("history offers cancel only before submission and an acknowledged resend afterwards", async () => {
  const rows = [delivery({ id: "dq", state: "queued", revision: "3" }), delivery({ id: "du", state: "outcome_unknown", code: "acknowledgement_lost", attempts: 1 }), delivery({ id: "da", state: "accepted", code: "smtp_accepted" })];
  respond((c) => { if (c.url.startsWith("/deliveries?")) return { body: { items: rows, total: 3, page: 0, size: 50 } }; });
  respond((c) => { if (c.method === "POST" && c.url === "/deliveries/dq/cancel") return { body: delivery({ id: "dq", state: "cancelled" }) }; });
  respond((c) => { if (c.method === "POST" && c.url === "/deliveries") return { status: 202, body: delivery({ id: "dn", resendOf: "du" }) }; });
  mount("/settings/email");
  const trs = await screen.findAllByTestId("delivery-row");
  expect(trs).toHaveLength(3);
  expect(within(trs[0]).queryByRole("button", { name: "Send again…" })).toBeNull();
  expect(within(trs[1]).queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(within(trs[1]).getByText("Outcome unknown")).toBeTruthy();
  expect(within(trs[1]).getByText(/may or may not have been accepted/)).toBeTruthy();
  expect(within(trs[2]).getByText("Accepted by the mail server")).toBeTruthy();
  fireEvent.click(within(trs[0]).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(sent("POST", "/deliveries/dq/cancel")).toHaveLength(1));
  expect(sent("POST", "/deliveries/dq/cancel")[0].body.baseRevision).toBe("3");
  // Resend: blocked until the duplicate warning is acknowledged.
  fireEvent.click(within(trs[1]).getByRole("button", { name: "Send again…" }));
  const dlg = await screen.findByRole("dialog", { hidden: true });
  expect(within(dlg).getByText(/may already have reached the recipient/)).toBeTruthy();
  const go = within(dlg).getByRole("button", { name: "Send again", hidden: true }) as HTMLButtonElement;
  await waitFor(() => expect(go.disabled).toBe(true));
  fireEvent.click(within(dlg).getByLabelText(/may deliver a duplicate/));
  await waitFor(() => expect(go.disabled).toBe(false));
  fireEvent.click(go);
  await waitFor(() => expect(sent("POST", "/deliveries")).toHaveLength(1));
  expect(sent("POST", "/deliveries")[0].body).toMatchObject({ resendOf: "du", acknowledgePossibleDuplicate: true, recipientRevision: "4", transportRevision: "2", fileId: "f1", contentVersion: "v1" });
});

// ---- KOReader conflicts --------------------------------------------------------

const conflict = (over: object = {}) => ({ id: "x1", revision: "0", fileId: "f1", contentVersion: "v1", credentialId: "k1", reason: "stale_revision",
  candidate: { progress: "epubcfi(/6/50)", percentage: 0.55, device: "Kobo B", deviceId: null }, currentRevision: "7", resolved: false, ...over });

test("resolving a retained position names the source revision the owner saw", async () => {
  respond((c) => { if (c.url.startsWith("/koreader/conflicts")) return { body: { items: [conflict(), conflict({ id: "x2", resolved: true, revision: "1" })], total: 2, page: 0, size: 200 } }; });
  respond((c) => { if (c.method === "POST" && c.url.endsWith("/resolve")) return { body: { revision: "8", fileId: "f1", contentVersion: "v1", source: "koreader", position: null } }; });
  respond((c) => { if (c.method === "POST" && c.url.endsWith("/reapply")) return { body: { revision: "9", fileId: "f1", contentVersion: "v1", source: "koreader", position: null } }; });
  mount("/settings/koreader");
  const cards = await screen.findAllByTestId("ko-conflict");
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).getByText(/Another device saved progress/)).toBeTruthy();
  expect(within(cards[0]).getByText(/separate from your place in the Litara reader/)).toBeTruthy();
  fireEvent.click(within(cards[0]).getByRole("button", { name: /Use this device/ }));
  await waitFor(() => expect(sent("POST", "/koreader/conflicts/x1/resolve")).toHaveLength(1));
  expect(sent("POST", "/koreader/conflicts/x1/resolve")[0].body).toMatchObject({ baseRevision: "7", action: "use_candidate" });
  // A resolved conflict can only be applied again as a deliberate, separate action.
  expect(within(cards[1]).queryByRole("button", { name: /Keep the saved position/ })).toBeNull();
  fireEvent.click(within(cards[1]).getByRole("button", { name: /Reapply this position/ }));
  await waitFor(() => expect(sent("POST", "/koreader/conflicts/x2/reapply")).toHaveLength(1));
  expect(sent("POST", "/koreader/conflicts/x2/reapply")[0].body.baseRevision).toBe("7");
});

test("a retained position for changed bytes can be dismissed but never applied", async () => {
  respond((c) => { if (c.url.startsWith("/koreader/conflicts")) return { body: { items: [conflict({ reason: "content_changed" })], total: 1, page: 0, size: 200 } }; });
  mount("/settings/koreader");
  const card = await screen.findByTestId("ko-conflict");
  expect((within(card).getByRole("button", { name: /Use this device/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(card).getByRole("button", { name: /Keep the saved position/ }) as HTMLButtonElement).disabled).toBe(false);
});

test("a stale resolve shows the server's refusal and reloads", async () => {
  let n = 0;
  respond((c) => { if (c.url.startsWith("/koreader/conflicts") && c.method === "GET") { n += 1; return { body: { items: [conflict({ currentRevision: n === 1 ? "7" : "8" })], total: 1, page: 0, size: 200 } }; } });
  respond((c) => { if (c.method === "POST" && c.url.endsWith("/resolve")) return { status: 409, body: { code: "stale_revision", detail: "The KOReader position changed; reload and retry.", currentRevision: "8" } }; });
  mount("/settings/koreader");
  fireEvent.click(await screen.findByRole("button", { name: /Keep the saved position/ }));
  expect(await screen.findByText(/stale_revision/)).toBeTruthy();
  await waitFor(() => expect(n).toBeGreaterThan(1));
});

// ---- administration ------------------------------------------------------------

test("administrators change enablement and limits at the revision they loaded", async () => {
  who = admin;
  respond((c) => { if (c.url === "/admin/delivery/smtp") return { body: { ...report, revision: "0", configured: false, enabled: false, host: "", username: "", hasPassword: false } }; });
  respond((c) => { if (c.method === "PUT" && c.url === "/admin/integrations/settings") return { body: { ...settings, revision: "4" } }; });
  mount("/admin/integrations");
  const form = await screen.findByRole("form", { name: "Integration settings" });
  fireEvent.click(within(form).getByLabelText("Email delivery")); // currently on: turn off
  fireEvent.change(within(form).getByLabelText(/Largest file/), { target: { value: "10" } });
  fireEvent.change(within(form).getByLabelText(/Emails per person/), { target: { value: "5" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(sent("PUT", "/admin/integrations/settings")).toHaveLength(1));
  expect(sent("PUT", "/admin/integrations/settings")[0].body).toMatchObject({
    baseRevision: "3", opdsEnabled: true, emailEnabled: false, koreaderEnabled: true, maxAttachmentBytes: 10 * 1048576, maxDeliveriesPerUserPerHour: 5,
  });
  expect(await screen.findByRole("form", { name: "Server mail settings" })).toBeTruthy();
});

test("the administration area is closed to ordinary accounts", async () => {
  mount("/admin/integrations");
  expect(await screen.findByText("Your account is not an administrator.")).toBeTruthy();
  expect(sent("GET", "/admin/delivery/smtp")).toHaveLength(0);
});

// ---- audio --------------------------------------------------------------------
