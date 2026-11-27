import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { knownColor, shadeFor, takesColor, withColor } from "./annotationColors";
import { AnnotationsPage } from "./pages/annotations/AnnotationsPage";

const sel = { kind: "foliate-range", version: 1, cfi: "epubcfi(/6/2!/4,/1:0,/1:5)" };
const item = (id: string, kind: string, selection: unknown, color?: string) => ({
  annotation: { id, editionId: "E", revision: "3", deleted: false, updatedAt: "2026-11-20T10:00:00Z",
    data: { kind, text: "my thought", quote: "the long road", anchor: { fileId: "F", contentVersion: "V", locator: {} }, selection, ...(color ? { color } : {}) } },
  createdAt: "2026-11-19T10:00:00Z", titleId: "T", title: "Second Volume", authors: ["Ada Author"], editionLabel: "", format: "epub",
});

const get = vi.fn(async (p: string): Promise<unknown> => {
  if (p === "/annotations/titles") return { items: [] };
  return { items: [item("1", "highlight", sel, "green"), item("2", "note", sel), item("3", "note", null), item("4", "bookmark", null)], total: 4, page: 0, size: 50 };
});
const api = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({}));
vi.mock("./api/client", async (orig) => ({ ...(await orig<object>()), get: (p: string) => get(p), api: (...a: unknown[]) => api(...a) }));

beforeEach(() => { get.mockClear(); api.mockClear(); });
afterEach(cleanup);

test("a stored name is drawn with a shade for the theme, and an unknown one with the default look", () => {
  expect(shadeFor("green", "light")).not.toBe(shadeFor("green", "dark"));
  expect(shadeFor("green", "sepia")).toBe(shadeFor("green", "light"));
  expect(shadeFor(undefined)).toBeUndefined();
  expect(shadeFor("purple")).toBeUndefined();
  expect(knownColor("orange")).toBe("orange");
});

test("only highlights and notes on selected text take a colour, and the default removes the field", () => {
  expect(takesColor({ kind: "highlight", selection: sel as never })).toBe(true);
  expect(takesColor({ kind: "note", selection: null })).toBe(false);
  expect(takesColor({ kind: "bookmark", selection: null })).toBe(false);
  expect(withColor({ text: "a", color: "blue" }, undefined)).toEqual({ text: "a" });
  expect("color" in withColor({ text: "a" } as { text: string; color?: string }, undefined)).toBe(false);
});

// ADR-0094: the chosen name is saved against the shown revision; nothing else about the annotation changes.
test("choosing a colour saves its name, and the default look leaves the field out", async () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AnnotationsPage /></MemoryRouter></QueryClientProvider>);
  const cards = await screen.findAllByTestId("annotation-card");
  expect(within(cards[0]!).getByRole("img", { name: "Green highlight" })).toBeTruthy();
  expect(within(cards[0]!).getByRole("button", { name: "Colour green" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(cards[1]!).getByRole("button", { name: "Default colour" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(cards[2]!).queryByRole("button", { name: /Colour/ })).toBeNull(); // a note on a page, not on text
  expect(within(cards[3]!).queryByRole("button", { name: /Colour/ })).toBeNull(); // a bookmark

  fireEvent.click(within(cards[1]!).getByRole("button", { name: "Colour pink" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("PUT", "/editions/E/annotations/2", expect.objectContaining({
    baseRevision: "3", data: expect.objectContaining({ color: "pink", text: "my thought", kind: "note" }) })));

  fireEvent.click(within(cards[0]!).getByRole("button", { name: "Default colour" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("PUT", "/editions/E/annotations/1", expect.anything()));
  const body = api.mock.calls.find((c) => c[1] === "/editions/E/annotations/1")![2] as { data: object };
  expect("color" in body.data).toBe(false);
});
