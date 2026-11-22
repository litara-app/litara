import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { MetadataReport, ProviderCandidate } from "../../api/types";
import { ProviderReview, reviewRows } from "./ProviderReview";

const report: MetadataReport = {
  editionId: "E1", revision: "4", fields: [
    { field: "title", source: "embedded", cleared: false, value: "Off Armageddon Reef", conflicts: [] },
    { field: "authors", source: "user", cleared: false, value: ["David Weber"], conflicts: [] },
    { field: "publisher", source: "user", cleared: true, value: null, conflicts: [] },
    { field: "language", source: "embedded", cleared: false, value: "en", conflicts: [] },
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

function setup(onApplied = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderReview subject={{ kind: "edition", id: "E1" }} report={report} onApplied={onApplied} />
    </QueryClientProvider>,
  );
  return onApplied;
}

test("search, review and apply writes only the ticked fields, chaining revisions", async () => {
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

  const puts = api.mock.calls.filter((c) => c[0] === "PUT");
  expect(puts.map((c) => c[1])).toEqual(["/admin/editions/E1/metadata/published", "/admin/editions/E1/metadata/page_count"]);
  const bodies = puts.map((c) => c[2] as { baseRevision: string; clear: boolean; value: unknown });
  expect(bodies.map((b) => b.baseRevision)).toEqual(["4", "5"]); // each write uses the revision the previous one returned
  expect(bodies.map((b) => b.value)).toEqual(["2007-01-09", 605]);
  expect(bodies.every((b) => b.clear === false)).toBe(true);
});

test("a library with lookups off says so and offers no results", async () => {
  api.mockImplementationOnce(async () => ({ ...results, enabled: false, results: [] }));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  expect(await screen.findByText(/Online lookups are off for this library/)).toBeTruthy();
});

test("an audiobook search sends the ASIN and its writes carry no revision", async () => {
  api.mockClear();
  const rec = { fields: [{ field: "title", source: "embedded", cleared: false, value: "Off Armageddon Reef", conflicts: [] }] };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderReview subject={{ kind: "recording", id: "R1" }} report={rec} onApplied={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  await screen.findByText("Exact ISBN match");
  expect(api).toHaveBeenCalledWith("POST", "/admin/recordings/R1/metadata/provider-search", { query: { title: "", authors: [], isbn: "" } });
  expect(screen.getByLabelText("ASIN")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Review Off Armageddon Reef/, hidden: true }));
  await screen.findByTestId("provider-review");
  fireEvent.click(screen.getByRole("button", { name: /^Apply \d+ fields?/, hidden: true }));
  await waitFor(() => expect(api.mock.calls.some((c) => c[0] === "PUT")).toBe(true));
  const put = api.mock.calls.find((c) => c[0] === "PUT")!;
  expect(String(put[1]).startsWith("/admin/recordings/R1/metadata/")).toBe(true);
  expect(Object.keys(put[2] as object)).toEqual(["value"]);
});

test("auto-fill posts the loaded revision for an edition and reports what it filled", async () => {
  api.mockClear();
  api.mockImplementationOnce(async () => ({ outcome: "filled", provider: "open_library", filled: ["publisher", "published"], revision: "5" }));
  const applied = setup();
  fireEvent.click(screen.getByRole("button", { name: "Auto-fill" }));
  expect((await screen.findByTestId("autofill-result")).textContent).toBe("Filled 2 empty fields from Open Library: publisher, published.");
  const call = api.mock.calls.find((c) => String(c[1]).endsWith("/auto-fill"))!;
  expect(call[0]).toBe("POST");
  expect(call[1]).toBe("/admin/editions/E1/metadata/auto-fill");
  expect(call[2]).toMatchObject({ baseRevision: "4" });
  expect(typeof (call[2] as { operationId: string }).operationId).toBe("string");
  await waitFor(() => expect(applied).toHaveBeenCalled());
});

test("auto-fill says when a result needs review and sends no body for an audiobook", async () => {
  api.mockClear();
  api.mockImplementationOnce(async () => ({ outcome: "needs_review", filled: [] }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderReview subject={{ kind: "recording", id: "R1" }} report={{ fields: [] }} onApplied={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Auto-fill" }));
  expect((await screen.findByTestId("autofill-result")).textContent).toMatch(/No single exact match/);
  expect(api).toHaveBeenCalledWith("POST", "/admin/recordings/R1/metadata/auto-fill", undefined);
});

test("saved results are labelled and Search again bypasses the cache; an unconfigured provider is explained", async () => {
  api.mockClear();
  const withCache = { ...results, results: [{ ...results.results[0], cached: true }, { provider: "hardcover", status: "unconfigured", candidates: [] }] };
  api.mockImplementationOnce(async () => withCache);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Search online" }));
  expect(await screen.findByText("Saved")).toBeTruthy();
  expect(screen.getByText("Hardcover")).toBeTruthy();
  expect(screen.getByText(/needs to add its access token/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Search again", hidden: true }));
  await waitFor(() => expect(api.mock.calls.filter((c) => String(c[1]).endsWith("/provider-search")).length).toBe(2));
  const second = api.mock.calls.filter((c) => String(c[1]).endsWith("/provider-search"))[1][2] as { fresh?: boolean };
  expect(second.fresh).toBe(true);
});
