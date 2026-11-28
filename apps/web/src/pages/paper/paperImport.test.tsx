import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PaperImport, PaperImportRow } from "../../api/types";
import { PaperImportPage, PaperImportsPage } from "./PaperImportPage";

const plan = { newBook: 0, addCopy: 0, readingOnly: 0, needsChoice: 0, already: 0, notOwned: 2, skipped: 0, unusable: 0, copies: 0 };
const base: PaperImport = {
  id: "I1", libraryId: "L1", source: "goodreads", state: "review", revision: "1", rows: 2, ownership: null, shelves: [], includeReading: false,
  fileShelves: [{ name: "paper", rows: 1 }], markedOwned: 1, withReading: 1, plan, createdAt: "2026-11-27T00:00:00Z", expiresAt: "2026-12-04T00:00:00Z",
};
const row: PaperImportRow = {
  row: 2, title: "Second Volume", authors: ["Ada Author"], isbn: null, shelves: ["paper"], selected: false, copies: 1, action: "needs_choice", titleId: null, choice: null,
  matches: [{ titleId: "T1", title: "Second Volume", authors: ["Ada Author"], series: null, sameIsbn: false }], problems: ["The rating \"9\" cannot be read and was left out."],
  outcome: null, detail: null, hasReading: false,
};
let current: PaperImport;
let calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
vi.mock("../../api/client", async (orig) => ({
  ...(await orig<object>()),
  get: async (p: string) => {
    if (p === "/libraries?size=200") return { items: [{ id: "L1", name: "Bookshelves" }], total: 1, page: 0, size: 200 };
    if (p === "/admin/paper-imports") return { items: [] };
    if (p.startsWith("/admin/paper-imports/I1/rows")) return { items: [row], total: 1, page: 0, size: 50 };
    return current;
  },
  api: async (method: string, path: string, body: Record<string, unknown>) => {
    calls.push({ method, path, body });
    if (path.endsWith("/options")) {
      const marked = body.ownership === "owned" ? { ...plan, newBook: 1, notOwned: 1, needsChoice: 1, copies: 1 } : plan;
      current = { ...current, ...body, revision: String(Number(current.revision) + 1), plan: marked } as PaperImport;
      return current;
    }
    if (path.endsWith("/apply")) {
      current = { ...current, state: "applying", plan: undefined, result: { added: 0, attached: 0, readingAdded: 0, skipped: 1, failed: 0, waiting: 1 } };
      return current;
    }
    return row;
  },
}));
let admin = true;
vi.mock("../../auth/session", () => ({ useAuth: () => ({ user: { isAdmin: admin } }) }));

beforeEach(() => { calls = []; admin = true; current = base; });
afterEach(cleanup);

const open = (at: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[at]}><Routes><Route path="/paper-imports" element={<PaperImportsPage />} /><Route path="/paper-imports/:importId" element={<PaperImportPage />} /></Routes></MemoryRouter>
  </QueryClientProvider>,
);

test("the ownership question starts unanswered and nothing can be applied until it is", async () => {
  open("/paper-imports/I1");
  expect(await screen.findByText("Choose an answer")).toBeTruthy();
  expect(screen.getByText("Say which books you own on paper before applying.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Apply import" }) as HTMLButtonElement).disabled).toBe(true);
  const reading = screen.getByRole("checkbox", { name: "These are my ratings, reviews and reading" });
  expect(reading.getAttribute("aria-checked")).toBe("false");
  expect(calls).toEqual([]);
});

test("a row shows its problems and takes the person's own selection", async () => {
  open("/paper-imports/I1");
  expect(await screen.findByText(/cannot be read and was left out/)).toBeTruthy();
  expect(screen.getByText("Needs your choice")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "I own row 2, Second Volume, on paper" }));
  await waitFor(() => expect(calls).toEqual([{ method: "PUT", path: "/admin/paper-imports/I1/rows/2", body: { selected: true } }]));
});

test("an answered import is applied only after confirming, at the revision shown", async () => {
  current = { ...base, ownership: "owned", revision: "3", plan: { ...plan, newBook: 1, needsChoice: 1, notOwned: 0, copies: 1 } };
  open("/paper-imports/I1");
  fireEvent.click(await screen.findByRole("button", { name: "Apply import" }));
  expect(calls).toEqual([]);
  const dialog = (await screen.findByText(/1 undecided row is skipped/)).closest<HTMLElement>("[data-slot='dialog-content'], dialog, [role='dialog']")!;
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply import", hidden: true }));
  await waitFor(() => expect(calls[0]).toEqual({ method: "POST", path: "/admin/paper-imports/I1/apply", body: { baseRevision: "3" } }));
  expect(await screen.findByTestId("import-progress")).toBeTruthy();
});

test("only administrators can import", async () => {
  admin = false;
  open("/paper-imports");
  expect(await screen.findByText("Administrators import books")).toBeTruthy();
});
