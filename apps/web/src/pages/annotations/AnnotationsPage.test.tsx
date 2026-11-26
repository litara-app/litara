import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AnnotationsPage, hubQuery } from "./AnnotationsPage";

const item = (id: string, kind: string, text: string, quote: string, title: string) => ({
  annotation: { id, editionId: "E-" + id, revision: "3", deleted: false, updatedAt: "2026-11-20T10:00:00Z",
    data: { kind, text, quote, anchor: { fileId: "F", contentVersion: "V", locator: {} }, selection: null } },
  createdAt: "2026-11-19T10:00:00Z", titleId: "T-" + id, title, authors: ["Ada Author"], editionLabel: "", format: "epub",
});

const get = vi.fn(async (p: string): Promise<unknown> => {
  if (p === "/annotations/titles") return { items: [{ titleId: "T-1", title: "Second Volume", authors: ["Ada Author"], annotations: 2 }] };
  return { items: [item("1", "highlight", "my thought", "the long road", "Second Volume"), item("2", "bookmark", "", "", "Other Tale")], total: 2, page: 0, size: 50 };
});
const api = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({}));
vi.mock("../../api/client", async (orig) => ({ ...(await orig<object>()), get: (p: string) => get(p), api: (...a: unknown[]) => api(...a) }));

beforeEach(() => { get.mockClear(); api.mockClear(); });
afterEach(cleanup);

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><AnnotationsPage /></MemoryRouter></QueryClientProvider>,
);

test("the filters become one query string for the list and the export", () => {
  expect(hubQuery("", "", "")).toBe("");
  expect(hubQuery("  50% sure ", "note", "T-1")).toBe("q=50%25+sure&kind=note&titleId=T-1");
});

// ADR-0099: the hub lists every annotation with its book, and edits use the revisioned annotation writes.
test("the hub lists annotations with their books and edits a note against its revision", async () => {
  renderPage();
  const cards = await screen.findAllByTestId("annotation-card");
  expect(cards).toHaveLength(2);
  expect(get).toHaveBeenCalledWith("/annotations?page=0&size=50");
  expect(within(cards[0]!).getByRole("link", { name: "Second Volume" }).getAttribute("href")).toBe("/titles/T-1");
  expect(within(cards[0]!).getByText("the long road")).toBeTruthy();
  expect(within(cards[0]!).getByRole("link", { name: /Open in reader/ }).getAttribute("href")).toBe("/read/E-1");
  expect(within(cards[1]!).queryByRole("button", { name: /note/i })).toBeNull(); // a bookmark has no note button
  expect(screen.getByTestId("total").textContent).toBe("2 entries");

  fireEvent.click(within(cards[0]!).getByRole("button", { name: /Edit note/ }));
  fireEvent.change(await screen.findByLabelText("Your note"), { target: { value: "changed" } });
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("PUT", "/editions/E-1/annotations/1", expect.objectContaining({
    baseRevision: "3", data: expect.objectContaining({ text: "changed", quote: "the long road" }) })));
});

test("searching asks the server with the typed text", async () => {
  renderPage();
  await screen.findAllByTestId("annotation-card");
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.change(screen.getByLabelText("Search annotations"), { target: { value: "road" } });
  await act(async () => { vi.advanceTimersByTime(400); });
  vi.useRealTimers();
  await waitFor(() => expect(get).toHaveBeenCalledWith("/annotations?q=road&page=0&size=50"));
});
