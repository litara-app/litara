import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { TitlePage } from "../TitlePage";

const cap = { state: "supported", issues: [] };
const edition = {
  id: "E1", titleId: "T1", libraryId: "L1", revision: "0", label: "EPUB", language: "en",
  file: { id: "F1", contentVersion: "v1", format: "epub", mimeType: "application/epub+zip", sizeBytes: 2048, availability: "available", contentPath: "/c" },
  readiness: "ready", issues: [], completion: { revision: "0", finished: false, changedAt: null },
  capabilities: { read: cap, download: cap, resume: cap, textSelection: cap, textHighlight: cap, pageNote: cap, bookmark: cap },
};
const answers: Record<string, unknown> = {
  "/titles/T1": { title: { id: "T1", title: "Treasure Island", authors: ["R. L. Stevenson"], series: [], languages: ["en"], editionCount: 1, recordingCount: 0 } },
  "/editions?titleId=T1&size=200": { items: [edition], total: 1, page: 0, size: 200 },
  "/titles/T1/recordings?size=200": { items: [], total: 0, page: 0, size: 200 },
  "/editions/E1/position": { revision: "0", position: null, unresolvedConflictCount: 0, conflictsPath: "" },
  "/editions/E1/annotations?includeDeleted=false&size=200": {
    items: [{ id: "A1", editionId: "E1", revision: "0", deleted: false, updatedAt: "2026-01-01T00:00:00Z", data: { kind: "highlight", anchor: {}, selection: null, text: "", quote: "Fifteen men on the dead man's chest" } }],
    total: 1, page: 0, size: 200,
  },
  "/titles/T1/reading-history?size=100": { items: [{ id: "R1", titleId: "T1", editionId: "E1", fileId: "F1", contentVersion: "v1", event: "manual_finish", capturedAt: "2026-01-02T00:00:00Z", receivedAt: "2026-01-02T00:00:00Z" }], total: 1, page: 0, size: 100 },
  "/titles/T1/personal": { titleId: "T1", revision: "0", data: { ratingHalves: null, review: "", startedAt: null, finishedAt: null }, derivedStartedAt: null, derivedFinishedAt: "2026-01-02T00:00:00Z", updatedAt: null },
  "/editions/E1/details": { editionId: "E1", addedAt: "2026-01-01T00:00:00Z", publisher: "Old House", published: "1895-05", pageCount: 118, isbn: "9783161484100", description: "A traveller builds a machine." },
  "/titles?sort=title&order=asc&page=0&size=24": { items: [{ id: "T1" }, { id: "T2" }, { id: "T3" }], total: 3, page: 0, size: 24 },
  "/admin/editions/E1/metadata": { editionId: "E1", revision: "0", fields: [
    { field: "title", source: "embedded", cleared: false, value: "Treasure Island", locked: false, conflicts: [] },
    { field: "subtitle", source: "user", cleared: false, value: "A Story", locked: false, conflicts: [] },
    { field: "isbn", source: "user", cleared: false, value: "9783161484100", locked: true, conflicts: [] },
  ] },
};
const api = vi.fn(async (_m: string, _p: string, body?: unknown): Promise<unknown> => ({ ...(answers["/titles/T1/personal"] as object), revision: "1", data: (body as { data: object }).data }));
vi.mock("../../api/client", async (orig) => ({ ...(await orig<object>()), get: async (p: string) => answers[p] ?? { items: [], total: 0, page: 0, size: 50 }, api: (m: string, p: string, b?: unknown) => api(m, p, b) }));
let admin = true;
vi.mock("../../auth/session", () => ({ useAuth: () => ({ user: { isAdmin: admin } }) }));

afterEach(() => { cleanup(); admin = true; });

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/titles/T1"]}><Routes><Route path="/titles/:titleId" element={<TitlePage />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

test("shows the title with its sections and a Read action", async () => {
  setup();
  expect(await screen.findByRole("heading", { name: "Treasure Island" })).toBeTruthy();
  for (const name of ["Details", "Files", "Highlights", "Reading log", "Edit metadata"]) expect(screen.getByRole("tab", { name })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Read" })).toBeTruthy();
});

test("people who are not administrators do not get the metadata editor", async () => {
  admin = false;
  setup();
  await screen.findByRole("heading", { name: "Treasure Island" });
  expect(screen.queryByRole("tab", { name: "Edit metadata" })).toBeNull();
});

test("the highlights tab lists the quoted text", async () => {
  setup();
  fireEvent.click(await screen.findByRole("tab", { name: "Highlights" }));
  expect(await screen.findByText("Fifteen men on the dead man's chest")).toBeTruthy();
});

test("the reading log lists finishing events", async () => {
  setup();
  fireEvent.click(await screen.findByRole("tab", { name: "Reading log" }));
  expect(await screen.findByText("Marked finished")).toBeTruthy();
});

test("the metadata tab shows each field with where it came from", async () => {
  setup();
  fireEvent.click(await screen.findByRole("tab", { name: "Edit metadata" }));
  expect(await screen.findByText("In the file")).toBeTruthy();
});

test("the metadata tab has one cover with its tools under it and no reading actions, and every field group", async () => {
  setup();
  fireEvent.click(await screen.findByRole("tab", { name: "Edit metadata" }));
  const tools = await screen.findByTestId("cover-editor");
  const side = screen.getByLabelText("Cover and actions");
  expect(side.contains(tools)).toBe(true);
  expect(side.querySelectorAll(".lt-cover").length).toBe(1); // the cover is shown once, not again in the editor
  expect(screen.queryByRole("link", { name: "Read" })).toBeNull(); // reading actions belong to the details tab
  expect(screen.queryByRole("button", { name: "Read" })).toBeNull();
  await screen.findByText("Public ratings"); // the fields load after the tools
  for (const label of ["Description", "Subtitle", "Genres", "Moods", "Age rating", "ASIN", "Hardcover ID", "Average rating"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  for (const group of ["Publishing", "Classification", "Identifiers", "Public ratings"]) expect(screen.getByText(group)).toBeTruthy();
  expect(screen.getByTestId("metadata-actions")).toBeTruthy();
});

/** The changes of every metadata save sent so far. */
const saves = () => api.mock.calls.filter((c) => c[0] === "PATCH" && c[1] === "/admin/editions/E1/metadata")
  .map((c) => c[2] as { baseRevision: string; changes: { field: string; action: string; clear?: boolean; value?: unknown }[] });

test("a field is edited in place, and locking sends a lock without changing the value", async () => {
  api.mockClear();
  setup();
  fireEvent.click(await screen.findByRole("tab", { name: "Edit metadata" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit Title" }));
  const input = await screen.findByRole("textbox", { name: "Title" });
  fireEvent.change(input, { target: { value: "Treasure Isle" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0]).toMatchObject({ baseRevision: "0", changes: [{ field: "title", action: "set", clear: false, value: "Treasure Isle" }] });
  fireEvent.click(await screen.findByRole("button", { name: "Lock Publisher as it is" }));
  await vi.waitFor(() => expect(saves()).toHaveLength(2));
  expect(saves()[1].changes).toEqual([{ field: "publisher", action: "lock" }]);
});

// ADR-0097: a lock is separate from an edit. A locked field is read-only until unlocked, unlocking keeps the value, and
// an unlocked edit can be reset to what the files say.
test("a locked field is read-only and unlocks without losing its value; an edit can be reset to source", async () => {
  api.mockClear();
  setup();
  fireEvent.click(await screen.findByRole("tab", { name: "Edit metadata" }));
  const isbn = await screen.findByTestId("field-isbn");
  expect(isbn.getAttribute("data-locked")).toBe("true");
  expect((screen.getByRole("button", { name: "ISBN is locked" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Reset ISBN to the value from the files" })).toBeNull(); // unlock first
  expect(screen.getAllByText("Edited").length).toBeGreaterThan(0); // the source of an edit, shown apart from the lock
  fireEvent.click(screen.getByRole("button", { name: "Unlock ISBN; the value stays" }));
  await vi.waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0].changes).toEqual([{ field: "isbn", action: "unlock" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Reset Subtitle to the value from the files" }));
  await vi.waitFor(() => expect(saves()).toHaveLength(2));
  expect(saves()[1].changes).toEqual([{ field: "subtitle", action: "reset" }]);
  expect(api.mock.calls.some((c) => c[0] === "PUT" || c[0] === "DELETE")).toBe(false);
});

test("the book position and previous/next arrows sit in the top bar and keep the tab", async () => {
  setup();
  fireEvent.click(await screen.findByRole("tab", { name: "Edit metadata" }));
  const pos = await screen.findByTestId("book-position");
  expect(pos.textContent).toBe("1 / 3");
  const next = screen.getByRole("link", { name: "Next book" });
  expect(next.getAttribute("href")).toBe("/titles/T2?tab=metadata");
  expect(screen.getByRole("button", { name: "Previous book" }).hasAttribute("disabled")).toBe(true);
});

test("the cover tools only appear on the metadata tab", async () => {
  setup();
  await screen.findByRole("heading", { name: "Treasure Island" });
  expect(screen.queryByTestId("cover-editor")).toBeNull();
});

test("the details tab shows publisher, pages, ISBN and the synopsis", async () => {
  setup();
  expect(await screen.findByText("Old House")).toBeTruthy();
  expect(screen.getByText("118")).toBeTruthy();
  expect(screen.getByText("9783161484100")).toBeTruthy();
  expect(await screen.findByText("A traveller builds a machine.")).toBeTruthy();
});

test("a rating is saved in half stars with the current revision", async () => {
  setup();
  fireEvent.click(await screen.findByRole("radio", { name: /3\.5 of 5 stars/ }));
  await vi.waitFor(() => expect(api).toHaveBeenCalled());
  const [method, path, body] = api.mock.calls.at(-1)!;
  expect(method).toBe("PUT");
  expect(path).toBe("/titles/T1/personal");
  expect(body).toMatchObject({ baseRevision: "0", data: { ratingHalves: 7 } });
});

test("an audiobook-only title shows its recording's details and can be edited as a recording", async () => {
  const saved = { editions: answers["/editions?titleId=T1&size=200"], recs: answers["/titles/T1/recordings?size=200"] };
  answers["/editions?titleId=T1&size=200"] = { items: [], total: 0, page: 0, size: 200 };
  answers["/titles/T1/recordings?size=200"] = { items: [{ id: "R1", libraryId: "L1", label: "Narrated", snapshotPath: "/s" }], total: 1, page: 0, size: 200 };
  answers["/recordings/R1/details"] = { recordingId: "R1", addedAt: "2026-02-03T00:00:00Z", publisher: "Audio House", published: "2019-03-12", isbn: null, description: "A recorded synopsis." };
  answers["/recordings/R1"] = { id: "R1", titleId: "T1", libraryId: "L1", title: "Treasure Island", authors: [], narrators: [], readiness: "ready", durationMs: 3_600_000, artwork: {}, completion: { revision: "0", finished: false, changedAt: null }, layoutRevision: "x", files: [], chapters: [], capabilities: { play: true, download: true, wholeRecordingSeek: true }, issues: [] };
  answers["/admin/recordings/R1/metadata"] = { revision: "2", fields: [{ field: "publisher", source: "embedded", cleared: false, value: "Audio House", locked: false }] };
  try {
    setup();
    expect(await screen.findByText("Audio House")).toBeTruthy();
    expect(await screen.findByText("A recorded synopsis.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("tab", { name: "Edit metadata" }));
    expect(await screen.findByText("Narrators")).toBeTruthy();
    expect(screen.queryByText("Pages")).toBeNull();
  } finally {
    answers["/editions?titleId=T1&size=200"] = saved.editions;
    answers["/titles/T1/recordings?size=200"] = saved.recs;
  }
});

test("auto-fill shows its fill as unsaved, a field can be reset, and save writes only what is left", async () => {
  api.mockClear();
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (_m: string, p: string) => {
    if (p.endsWith("/auto-fill")) return { outcome: "proposed", provider: "open_library", rule: "title_author", filled: [], revision: "0", proposed: { publisher: "Press", subtitle: "A Tale" } };
    return { revision: "1" };
  });
  try {
    setup();
    fireEvent.click(await screen.findByRole("tab", { name: "Edit metadata" }));
    fireEvent.click(await screen.findByRole("button", { name: "Auto-fill" }));
    await screen.findByTestId("autofill-draft");
    expect(screen.getByTestId("draft-publisher").textContent).toBe("Press");
    expect(screen.getByTestId("draft-subtitle").textContent).toBe("A Tale");
    expect(saves()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset Publisher to what it was" }));
    expect(screen.queryByTestId("draft-publisher")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 field" }));
    await vi.waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].changes).toEqual([{ field: "subtitle", action: "set", clear: false, value: "A Tale" }]);
    await vi.waitFor(() => expect(screen.queryByTestId("autofill-draft")).toBeNull());
  } finally {
    api.mockImplementation(original);
  }
});

test("Reset all discards the whole unsaved fill without writing anything", async () => {
  api.mockClear();
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (_m: string, p: string) => (p.endsWith("/auto-fill")
    ? { outcome: "proposed", provider: "hardcover", rule: "identifier", filled: [], revision: "0", proposed: { publisher: "Press" } }
    : { revision: "1" }));
  try {
    setup();
    fireEvent.click(await screen.findByRole("tab", { name: "Edit metadata" }));
    fireEvent.click(await screen.findByRole("button", { name: "Auto-fill" }));
    await screen.findByTestId("autofill-draft");
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(screen.queryByTestId("autofill-draft")).toBeNull();
    expect(saves()).toHaveLength(0);
  } finally {
    api.mockImplementation(original);
  }
});
