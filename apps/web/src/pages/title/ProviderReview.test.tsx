import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { MetadataReport, ProviderCandidate } from "../../api/types";
import { currentNotices } from "../../ui/notify";
import { ProviderReview, reviewRows } from "./ProviderReview";

const report: MetadataReport = {
  editionId: "E1", revision: "4", fields: [
    { field: "title", source: "embedded", cleared: false, value: "Off Armageddon Reef", locked: false, conflicts: [] },
    { field: "authors", source: "user", cleared: false, value: ["David Weber"], locked: false, conflicts: [] },
    { field: "publisher", source: "user", cleared: true, value: null, locked: false, conflicts: [] },
    { field: "language", source: "embedded", cleared: false, value: "en", locked: false, conflicts: [] },
  ],
};
const candidate: ProviderCandidate = {
  id: "vol1", byIdentifier: true, consistent: true,
  fields: { title: "Off Armageddon Reef (Safehold)", authors: ["D. Weber"], publisher: "Tor Books", published: "2007-01-09", language: "en", page_count: 605 },
};

afterEach(cleanup);

test("only fields with nothing stored are preselected; edits, clears and file values are not", () => {
  const rows = Object.fromEntries(reviewRows(report, candidate).map((r) => [r.field, r]));
  expect(Object.keys(rows).sort()).toEqual(["authors", "page_count", "published", "publisher", "title"]); // language is identical, so it is not offered
  expect(rows.published.preselected).toBe(true);
  expect(rows.page_count.preselected).toBe(true);
  expect(rows.title.preselected).toBe(false);
  expect(rows.authors.preselected).toBe(false);
  expect(rows.authors.protectedEdit).toBe(true);
  expect(rows.publisher.preselected).toBe(false); // a deliberate clear is not a gap
  expect(rows.publisher.current).toBe("Deliberately empty");
});

const results = {
  editionId: "E1", enabled: true, query: { title: "Off Armageddon Reef", authors: ["David Weber"], isbn: "" },
  results: [
    { provider: "open_library", status: "ok", candidates: [candidate] },
    { provider: "google_books", status: "unavailable", candidates: [] },
  ],
};
const api = vi.fn(async (_method: string, path: string, body?: unknown): Promise<unknown> => {
  if (path.endsWith("/provider-search")) return results;
  return { editionId: "E1", revision: String(Number((body as { baseRevision: string }).baseRevision) + 1), fields: [] };
});
vi.mock("../../api/client", async (orig) => ({ ...(await orig<object>()), api: (m: string, p: string, b?: unknown) => api(m, p, b) }));

const draftSpy = vi.fn();
function setup(onApplied = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderReview subject={{ kind: "edition", id: "E1" }} report={report} onApplied={onApplied} onDraft={draftSpy} />
    </QueryClientProvider>,
  );
  return onApplied;
}

/** The changes of every metadata save sent so far. */
const saves = () => api.mock.calls.filter((c) => c[0] === "PATCH")
  .map((c) => ({ path: c[1], ...(c[2] as { baseRevision: string; changes: { field: string; action: string; clear?: boolean; value?: unknown }[] }) }));

test("search, review and apply saves only the ticked fields, together in one save", async () => {
  api.mockClear();
  const applied = setup();
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  expect(await screen.findByText("Exact ISBN match")).toBeTruthy();
  expect(screen.getByText(/Could not be reached/)).toBeTruthy(); // an unavailable provider is reported, not hidden
  expect(api).toHaveBeenCalledWith("POST", "/admin/editions/E1/metadata/provider-search", { query: { title: "", authors: [], isbn: "" } });

  fireEvent.click(screen.getByRole("button", { name: /^Review Off Armageddon Reef/, hidden: true }));
  expect(await screen.findByTestId("provider-review")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Apply 2 fields", hidden: true }));
  await waitFor(() => expect(applied).toHaveBeenCalled());

  expect(saves()).toEqual([{ path: "/admin/editions/E1/metadata", operationId: expect.any(String), baseRevision: "4", changes: [
    { field: "published", action: "set", clear: false, value: "2007-01-09" }, { field: "page_count", action: "set", clear: false, value: 605 },
  ] }]);
  expect(api.mock.calls.some((c) => c[0] === "PUT")).toBe(false);
});

test("a library with lookups off says so and offers no results", async () => {
  api.mockImplementationOnce(async () => ({ ...results, enabled: false, results: [] }));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  expect(await screen.findByText(/Online lookups are off for this library/)).toBeTruthy();
});

test("an audiobook search sends the ASIN and its save carries the title's metadata revision", async () => {
  api.mockClear();
  const rec = { revision: "7", fields: [{ field: "title", source: "embedded", cleared: false, value: "Off Armageddon Reef", locked: false, conflicts: [] }] };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderReview subject={{ kind: "recording", id: "R1" }} report={rec} onApplied={vi.fn()} onDraft={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  await screen.findByText("Exact ISBN match");
  expect(api).toHaveBeenCalledWith("POST", "/admin/recordings/R1/metadata/provider-search", { query: { title: "", authors: [], isbn: "" } });
  expect(screen.getByLabelText("ASIN")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Review Off Armageddon Reef/, hidden: true }));
  await screen.findByTestId("provider-review");
  fireEvent.click(screen.getByRole("button", { name: /^Apply \d+ fields?/, hidden: true }));
  await waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0]).toMatchObject({ path: "/admin/recordings/R1/metadata", baseRevision: "7" });
});

test("auto-fill asks for a dry run with the loaded revision and hands the proposed values over for review without saving", async () => {
  api.mockClear();
  draftSpy.mockClear();
  api.mockImplementationOnce(async () => ({ outcome: "proposed", provider: "open_library", rule: "title_author", filled: [], revision: "4", proposed: { publisher: "Press", published: "2007-01-09" } }));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Auto-fill" }));
  await waitFor(() => expect(draftSpy).toHaveBeenCalledWith({ provider: "open_library", rule: "title_author", values: { publisher: "Press", published: "2007-01-09" }, revision: "4" }));
  expect(currentNotices()[0]?.detail).toBe("Found 2 fields from Open Library, matched by title and author. Review them, then save.");
  const call = api.mock.calls.find((c) => String(c[1]).endsWith("/auto-fill"))!;
  expect(call[0]).toBe("POST");
  expect(call[1]).toBe("/admin/editions/E1/metadata/auto-fill");
  expect(call[2]).toMatchObject({ baseRevision: "4", dryRun: true });
  expect(typeof (call[2] as { operationId: string }).operationId).toBe("string");
  expect(saves()).toHaveLength(0); // nothing is stored until the person saves
});

test("auto-fill says when a result needs review and asks an audiobook for a dry run too", async () => {
  api.mockClear();
  draftSpy.mockClear();
  api.mockImplementationOnce(async () => ({ outcome: "needs_review", filled: [] }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderReview subject={{ kind: "recording", id: "R1" }} report={{ revision: "3", fields: [] }} onApplied={vi.fn()} onDraft={draftSpy} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Auto-fill" }));
  await waitFor(() => expect(currentNotices()[0]?.detail).toMatch(/No single exact match/));
  expect(api).toHaveBeenCalledWith("POST", "/admin/recordings/R1/metadata/auto-fill?dryRun=true", undefined);
  expect(draftSpy).not.toHaveBeenCalled();
});

test("saved results are labelled and Search again bypasses the cache; an unconfigured provider is explained", async () => {
  api.mockClear();
  const withCache = { ...results, results: [{ ...results.results[0], cached: true }, { provider: "hardcover", status: "unconfigured", candidates: [] }] };
  api.mockImplementationOnce(async () => withCache);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  expect(await screen.findByText("Saved")).toBeTruthy();
  expect(screen.getAllByText("Hardcover").length).toBeGreaterThan(0);
  expect(screen.getByText(/needs to add its access token/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Search again", hidden: true }));
  await waitFor(() => expect(api.mock.calls.filter((c) => String(c[1]).endsWith("/provider-search")).length).toBe(2));
  const second = api.mock.calls.filter((c) => String(c[1]).endsWith("/provider-search"))[1][2] as { fresh?: boolean };
  expect(second.fresh).toBe(true);
});

test("a search can be limited to some of the providers, and every provider is searched by default", async () => {
  api.mockClear();
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  await screen.findByText("Exact ISBN match");
  fireEvent.click(screen.getByRole("button", { name: "Open Library", hidden: true }));
  fireEvent.click(screen.getByRole("button", { name: "Search", hidden: true }));
  await waitFor(() => expect(api.mock.calls.filter((c) => String(c[1]).endsWith("/provider-search")).length).toBe(2));
  const second = api.mock.calls.filter((c) => String(c[1]).endsWith("/provider-search"))[1][2] as { providers?: string[] };
  expect(second.providers).toEqual(["open_library"]);
});

test("every offered field can be seen, and a list field can be merged or replaced", async () => {
  api.mockClear();
  const withList = { ...candidate, fields: { ...candidate.fields, genres: ["Fantasy", "Fiction"] } };
  const rep = { editionId: "E1", revision: "4", fields: [...report.fields, { field: "genres", source: "embedded", cleared: false, value: ["Fiction", "Magic"], locked: false, conflicts: [] }] };
  api.mockImplementationOnce(async () => ({ ...results, results: [{ provider: "open_library", status: "ok", candidates: [withList] }] }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderReview subject={{ kind: "edition", id: "E1" }} report={rep} onApplied={vi.fn()} onDraft={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Review Off Armageddon Reef/, hidden: true }));
  const review = await screen.findByTestId("provider-review");
  expect(review.textContent).not.toMatch(/Language/); // identical, so only under All fields
  fireEvent.click(screen.getByRole("radio", { name: /All fields/, hidden: true }));
  expect(screen.getByTestId("provider-review").textContent).toMatch(/Language/);
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "What to do with genres", hidden: true })).getByRole("radio", { name: "Merge", hidden: true }));
  fireEvent.click(screen.getByRole("button", { name: /^Apply 3 fields/, hidden: true }));
  await waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0].changes.find((c) => c.field === "genres")!.value).toEqual(["Fiction", "Magic", "Fantasy"]); // stored items first, new ones added
});

// ADR-0097: "Use all" leaves edits and deliberate clears alone; each can still be chosen by itself.
test("use all skips the person's edits and deliberate clears, which can still be chosen one at a time", async () => {
  api.mockClear();
  const applied = setup();
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Review Off Armageddon Reef/, hidden: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Use all 3", hidden: true })); // title, published, page_count
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "What to do with publisher", hidden: true })).getByRole("radio", { name: "Use", hidden: true }));
  fireEvent.click(screen.getByRole("button", { name: "Apply 4 fields", hidden: true }));
  await waitFor(() => expect(applied).toHaveBeenCalled());
  const written = saves()[0].changes.map((c) => c.field);
  expect(written.sort()).toEqual(["page_count", "published", "publisher", "title"]); // authors, an edit, was left alone
});

// ADR-0097: a locked field cannot be chosen until it is unlocked, and "Use all" leaves it alone.
test("a locked field is shown but cannot be applied", async () => {
  api.mockClear();
  const locked = { ...report, fields: report.fields.map((f) => (f.field === "title" ? { ...f, source: "user", locked: true } : f)) };
  const rows = Object.fromEntries(reviewRows(locked, candidate).map((r) => [r.field, r]));
  expect(rows.title.locked).toBe(true);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderReview subject={{ kind: "edition", id: "E1" }} report={locked} onApplied={vi.fn()} onDraft={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Review Off Armageddon Reef/, hidden: true }));
  await screen.findByTestId("provider-review");
  expect(screen.queryByRole("radiogroup", { name: "What to do with title", hidden: true })).toBeNull();
  expect(screen.getByText(/Unlock it on the Metadata tab/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use all 2", hidden: true })); // published, page_count
  fireEvent.click(screen.getByRole("button", { name: "Apply 2 fields", hidden: true }));
  await waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0].changes.map((c) => c.field).sort()).toEqual(["page_count", "published"]);
});
