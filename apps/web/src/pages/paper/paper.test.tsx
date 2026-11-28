import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { ApiError } from "../../api/client";
import { TitlePage } from "../TitlePage";
import { AddPaperBook } from "./AddPaperBook";
import { copyDetails, emptyCopy, fromCandidate, operationIds } from "./paper";

const title = { id: "P1", title: "Paper Walls", authors: ["Nell Printed"], series: [], languages: [], editionCount: 0, recordingCount: 0, physicalCopyCount: 1, lastActivityAt: null };
const copy = { id: "C1", titleId: "P1", libraryId: "L1", revision: "1", binding: "paperback", pageCount: 320, location: "Study", addedAt: "2026-11-01T00:00:00Z" };
const answers: Record<string, unknown> = {
  "/libraries?size=200": { items: [{ id: "L1", name: "Bookshelves" }], total: 1, page: 0, size: 200 },
  "/titles/P1": { title, editionsPath: "", recordingsPath: "", publisher: "Quire", published: "1999", description: "About walls." },
  "/titles/P1/physical-copies?size=200": { items: [copy], total: 1, page: 0, size: 200 },
  "/titles/P1/personal": { titleId: "P1", revision: "0", data: { ratingHalves: null, review: "", startedAt: null, finishedAt: null }, derivedStartedAt: null, derivedFinishedAt: null, updatedAt: null },
  "/physical-copies/C1/reading": { copyId: "C1", revision: "0", status: "not_started", page: null, changedAt: null },
};
type Call = { method: string; path: string; body: Record<string, unknown> };
let calls: Call[] = [];
let reply: (c: Call) => unknown;
vi.mock("../../api/client", async (orig) => ({
  ...(await orig<object>()),
  get: async (p: string) => answers[p] ?? { items: [], total: 0, page: 0, size: 50 },
  api: async (method: string, path: string, body: Record<string, unknown>) => { const c = { method, path, body }; calls.push(c); return reply(c); },
}));
let admin = true;
vi.mock("../../auth/session", () => ({ useAuth: () => ({ user: { isAdmin: admin } }) }));

beforeEach(() => { calls = []; admin = true; });
afterEach(cleanup);

const wrap = (node: React.ReactNode, at = "/") => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[at]}><Routes><Route path="/" element={node} /><Route path="/titles/:titleId" element={node} /></Routes></MemoryRouter>
  </QueryClientProvider>,
);

test("only the filled copy details are sent, and a repeat of a request keeps its operation ID", () => {
  expect(JSON.parse(JSON.stringify(copyDetails({ ...emptyCopy, location: "  Loft ", pageCount: 12 })))).toEqual({ location: "Loft", pageCount: 12 });
  const next = operationIds();
  const first = next({ a: 1 });
  expect(next({ a: 1 })).toBe(first);
  expect(next({ a: 2 })).not.toBe(first);
  expect(fromCandidate({ title: "T", authors: ["A", "B"], page_count: 9, isbn: "x" })).toEqual({ book: { title: "T", authors: "A, B" }, copy: { pageCount: 9 } });
});

test("a paper-only title offers no reading, listening or downloading, and shows its own details and copy", async () => {
  reply = () => ({ items: [], total: 0, page: 0, size: 50 });
  wrap(<TitlePage />, "/titles/P1");
  expect(await screen.findByRole("heading", { name: "Paper Walls" })).toBeTruthy();
  expect(await screen.findByText("About walls.")).toBeTruthy();
  expect(screen.getByText("Quire")).toBeTruthy();
  expect(await screen.findByText("Paperback, Study")).toBeTruthy();
  for (const name of [/^Read$/, /^Listen/, /^Download/, /Send to device/]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByRole("link", { name: "Read" })).toBeNull();
  expect(screen.getByRole("button", { name: "Add to shelf" })).toBeTruthy();
  for (const name of ["Files", "Highlights"]) expect(screen.queryByRole("tab", { name })).toBeNull();
  expect(screen.getByTitle("Owned on paper")).toBeTruthy();
});

test("reading a copy needs no page number", async () => {
  const before = answers["/physical-copies/C1/reading"];
  onTestFinished(() => { answers["/physical-copies/C1/reading"] = before; });
  // Like the server, later reads return what was written.
  reply = (c) => c.method !== "PUT" ? { items: [], total: 0, page: 0, size: 50 }
    : (answers["/physical-copies/C1/reading"] = { copyId: "C1", revision: "1", status: c.body.status, page: null, changedAt: "2026-11-20T00:00:00Z" });
  admin = false;
  wrap(<TitlePage />, "/titles/P1");
  fireEvent.click(await screen.findByRole("button", { name: "Start reading" }));
  const writes = () => calls.filter((c) => c.method === "PUT");
  await waitFor(() => expect(writes().length).toBe(1));
  expect(writes()[0]).toMatchObject({ method: "PUT", path: "/physical-copies/C1/reading", body: { status: "reading", baseRevision: "0" } });
  expect("page" in writes()[0]!.body).toBe(false);
  expect(await screen.findByRole("button", { name: "Save page" })).toBeTruthy();
  // Someone who is not an administrator cannot manage copies.
  for (const name of ["Add paper copy", "Edit copy", "Remove copy"]) expect(screen.queryByRole("button", { name })).toBeNull();
});

test("a lookup names each provider that answered or failed", async () => {
  reply = () => ({ enabled: true, matches: [], results: [
    { provider: "goodreads", status: "ok", cached: false, candidates: [{ id: "1", byIdentifier: true, consistent: true, fields: { title: "Paper Walls" } }] },
    { provider: "open_library", status: "unavailable", cached: false, candidates: [] },
  ] });
  wrap(<AddPaperBook onClose={() => {}} />);
  await screen.findByLabelText("Title"); // the form has two ISBN fields: the one to look up comes first
  fireEvent.change(screen.getAllByLabelText("ISBN")[0]!, { target: { value: "9780306406157" } });
  const lookUp = screen.getByRole("button", { name: "Look up" });
  await waitFor(() => expect((lookUp as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(lookUp);
  const found = await screen.findByTestId("paper-lookup");
  expect(within(found).getByText("Goodreads")).toBeTruthy();
  expect(within(found).getByText("Could not ask Open Library.")).toBeTruthy();
});

test("a book that may already be in the catalogue is added only after the person chooses", async () => {
  const match = { titleId: "T9", title: "Paper Walls", authors: ["Nell Printed"], series: null, sameIsbn: false };
  reply = (c) => {
    if (c.path.endsWith("/physical-lookup")) return { enabled: false, results: [], matches: [match] };
    if (!c.body.separateFromMatches) throw new ApiError(409, { code: "title_match", detail: "match" } as never);
    return { ...copy, id: "C2", titleId: "NEW" };
  };
  const closed = vi.fn();
  wrap(<AddPaperBook onClose={closed} />);
  fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Paper Walls" } });
  const submit = screen.getByRole("button", { name: "Add book" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);
  const asked = await screen.findByTestId("paper-matches");
  expect(closed).not.toHaveBeenCalled();
  expect(within(asked).getByRole("button", { name: "Add the copy to this book" })).toBeTruthy();
  fireEvent.click(within(asked).getByRole("button", { name: "Add as a separate book" }));
  await waitFor(() => expect(closed).toHaveBeenCalled());
  const adds = calls.filter((c) => c.path === "/admin/physical-copies");
  expect(adds.map((c) => c.body.separateFromMatches)).toEqual([undefined, true]);
  expect(adds[0]!.body.operationId).not.toBe(adds[1]!.body.operationId);
});
