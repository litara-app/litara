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
  "/admin/editions/E1/metadata": { editionId: "E1", revision: "0", fields: [{ field: "title", source: "embedded", cleared: false, value: "Treasure Island", conflicts: [] }] },
};
const api = vi.fn(async (_m: string, _p: string, body?: unknown) => ({ ...(answers["/titles/T1/personal"] as object), revision: "1", data: (body as { data: object }).data }));
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
  answers["/admin/recordings/R1/metadata"] = { fields: [{ field: "publisher", source: "embedded", cleared: false, value: "Audio House" }] };
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
