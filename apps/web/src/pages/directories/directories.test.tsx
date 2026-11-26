import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { Title, TitleRow } from "../../api/types";
import { initials } from "../../ui/people";
import { AuthorPage, AuthorsPage, SeriesListPage, SeriesPage } from "./DirectoryPages";
import { RelatedRows } from "./RelatedRows";
import { groupBySeries, missingNumbers } from "./directory";

const row = (id: string, title: string, series: string | null, index: number | null, authors = ["Ada Author"]): TitleRow => ({
  id, title, authors, series: series ? [series] : [], languages: [], editionCount: 1, recordingCount: 0,
  libraryIds: [], formats: ["epub"], addedAt: "", seriesIndex: index, publisher: null, published: null, pageCount: null, ratingHalves: null, status: "unread",
});
const SAGA = [row("1", "First", "The Saga", 1), row("4", "Fourth", "the saga", 4), row("2", "Second", "The Saga", 2)];
const LOOSE = [row("9", "Alone", null, null), row("5", "Bridge", "Other", 1)];

const search = async (_m: string, _p: string, body: { filter: { field: string; value: string[] } }): Promise<unknown> => {
  const items = body.filter.field === "series" ? SAGA : [...SAGA, ...LOOSE];
  return { items, total: items.length, page: 0, size: 200 };
};
const api = vi.fn(search);
let next: unknown = { titleId: "2", title: "Second", medium: "ebook", state: "reading" };
let admin = false;
vi.mock("../../auth/session", () => ({ useAuth: () => ({ user: { isAdmin: admin } }) }));
const field = (name: string, value: unknown = null, source = value === null ? "none" : "user", locked = false) => ({ field: name, value, source, cleared: false, locked });
const authorDetails = () => ({
  name: "Ada Author", revision: "4", photo: { source: "none", version: null as string | null, locked: false },
  fields: [field("last_name", "Author", "guessed"), field("introduction", "Writes sagas."), field("biography", "Born by the sea.", "user", true)],
});
let details: unknown = authorDetails();
let missingBooks: unknown = { items: [] };
const responses = async (p: string): Promise<unknown> => {
  if (p.startsWith("/continue-reading")) return next;
  if (p.startsWith("/authors/details")) return details;
  if (p.startsWith("/series/missing")) return missingBooks;
  if (p.startsWith("/series/details")) {
    return { name: "The Saga", revision: "2", fields: [field("description", "Five parishes."), field("book_count", 6), field("status", "ongoing")] };
  }
  if (p.startsWith("/series")) {
    return { items: [{ name: "The Saga", titles: 3, coverTitleId: "1", authors: ["Ada Author"], finished: 1, covers: [{ titleId: "1", title: "First", medium: "ebook" }, { titleId: "2", title: "Second", medium: "audio" }] }], total: 1, page: 0, size: 60 };
  }
  return {
    items: ["Ada Author", "Bo Writer", "Cy Panel"].map((name) => ({
      name, titles: 5, coverTitleId: "1", seriesCount: name === "Cy Panel" ? 0 : 2, lastName: name.split(" ")[1], photoVersion: name === "Bo Writer" ? "v1" : null,
    })),
    letters: ["A", "P", "W"], total: 3, page: 0, size: 60,
  };
};
const get = vi.fn(responses);
vi.mock("../../api/client", async (orig) => ({
  ...(await orig<object>()), api: (m: string, p: string, b: never) => api(m, p, b), get: (p: string) => get(p),
}));
const read = vi.fn(async (_id: string) => {});
const listen = vi.fn(async (_id: string) => {});
vi.mock("../useTitleActions", () => ({ useTitleActions: () => ({ read, listen, download: vi.fn() }) }));
beforeEach(() => {
  api.mockClear(); api.mockImplementation(search); get.mockClear(); read.mockClear(); listen.mockClear(); sessionStorage.clear();
  next = { titleId: "2", title: "Second", medium: "ebook", state: "reading" };
  admin = false; details = authorDetails(); missingBooks = { items: [] };
});
afterEach(cleanup);

const at = (path: string, route: string, el: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter></QueryClientProvider>,
);

test("series order, grouping and missing numbers follow ADR-0100", () => {
  expect(missingNumbers([1, 2, 4, null])).toEqual([3]);
  expect(missingNumbers([2.5, 1])).toEqual([]);
  expect(missingNumbers([null])).toEqual([]);
  const groups = groupBySeries([...SAGA, ...LOOSE]);
  expect(groups.map((g) => g.series)).toEqual(["Other", "The Saga", null]); // series by name, then books in no series
  expect(groups[1]!.titles.map((t) => t.title)).toEqual(["First", "Second", "Fourth"]); // one series despite the case
});

test("initials stand in for a photo", () => {
  expect(initials("R. T. Marlowe")).toBe("RTM");
  expect(initials("  ursula k. le guin ")).toBe("UKL");
  expect(initials("")).toBe("");
});

test("the authors directory shows a card per author with initials, books and series", async () => {
  at("/authors", "/authors", <AuthorsPage />);
  const items = await screen.findAllByTestId("directory-item");
  expect(get).toHaveBeenCalledWith("/authors?page=0&size=60");
  expect(items[0]!.getAttribute("href")).toBe("/authors/Ada%20Author");
  expect(items[0]!.textContent).toContain("AA");
  expect(items[0]!.textContent).toContain("5books"); // the ribbon
  expect(items[0]!.textContent).toContain("2 series");
  expect(items[2]!.textContent).toContain("No series");
  expect(items[1]!.querySelector("img")!.getAttribute("src")).toBe("/api/v1/authors/photo?name=Bo+Writer&v=v1");
});

test("the A to Z row filters authors by letter and offers only letters with someone", async () => {
  at("/authors", "/authors", <AuthorsPage />);
  await screen.findAllByTestId("directory-item");
  const rail = screen.getByRole("group", { name: "Filter by first letter of last name" });
  expect((within(rail).getByRole("button", { name: "B" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(rail).getByRole("button", { name: "W" }));
  await vi.waitFor(() => expect(get).toHaveBeenCalledWith("/authors?letter=W&page=0&size=60"));
  await vi.waitFor(() => expect(screen.getByTestId("total").textContent).toBe("3 authors with a last name starting with W"));
  expect(within(rail).getByRole("button", { name: "W" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(rail).getByRole("button", { name: "All" }));
  await vi.waitFor(() => expect(screen.getByTestId("total").textContent).toBe("3 authors"));
});

test("the series directory stacks covers and shows progress", async () => {
  at("/series", "/series", <SeriesListPage />);
  const card = await screen.findByTestId("directory-item");
  expect(card.getAttribute("href")).toBe("/series/The%20Saga");
  expect(card.textContent).toContain("1 of 3 finished");
  expect([...card.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(
    [expect.stringContaining("/titles/1/cover?medium=ebook"), expect.stringContaining("/titles/2/cover?medium=audio")]);
});

test("an author page lists works by series, shelves the books and continues the one in progress", async () => {
  at("/authors/Ada%20Author", "/authors/:name", <AuthorPage />);
  const groups = await screen.findAllByTestId("author-group");
  expect(api).toHaveBeenCalledWith("POST", "/titles/search", expect.objectContaining({ filter: { type: "rule", field: "author", operator: "is", value: ["Ada Author"] } }));
  expect(groups.map((g) => g.textContent)).toEqual(["Other1 book", "The Saga3 books", "No series1 book"]);
  expect(screen.getByRole("img", { name: "No photo of Ada Author" })).toBeTruthy();
  expect((await screen.findByTestId("introduction")).textContent).toBe("Writes sagas.");
  expect(screen.getByTestId("biography").textContent).toBe("Born by the sea.");
  expect(screen.queryByRole("tab")).toBeNull(); // only an administrator edits
  expect(screen.getAllByTestId("book-item").map((b) => b.getAttribute("href"))).toEqual(["/titles/5", "/titles/1", "/titles/2", "/titles/4", "/titles/9"]);

  fireEvent.click(screen.getByRole("radio", { name: "The Saga" }));
  expect(screen.getAllByTestId("book-item").map((b) => b.getAttribute("href"))).toEqual(["/titles/1", "/titles/2", "/titles/4"]);

  await screen.findByTestId("continue-title"); // until it arrives the button is a disabled placeholder
  fireEvent.click(screen.getByRole("button", { name: "Continue reading" }));
  expect(get).toHaveBeenCalledWith("/continue-reading?by=author&name=Ada+Author");
  expect(read).toHaveBeenCalledWith("2");
});

test("the previous and next buttons follow the directory", async () => {
  at("/authors/Bo%20Writer", "/authors/:name", <AuthorPage />);
  expect((await screen.findByTestId("directory-position")).textContent).toBe("2 / 3");
  expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/authors/Ada%20Author");
  expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/authors/Cy%20Panel");
});

test("a series page is in reading order with a place for each missing book", async () => {
  next = { titleId: "4", title: "Fourth", medium: "audio", state: "unread" };
  at("/series/The%20Saga", "/series/:name", <SeriesPage />);
  const found = await screen.findAllByTestId("book-item");
  expect(api).toHaveBeenCalledWith("POST", "/titles/search", expect.objectContaining({ sort: "series_index", filter: expect.objectContaining({ field: "series", value: ["The Saga"] }) }));
  expect(found.map((b) => b.getAttribute("href"))).toEqual(["/titles/1", "/titles/4", "/titles/2"]); // the server's order is kept
  expect(screen.getByTestId("missing-book").textContent).toContain("Book 3 is not in your libraries");
  fireEvent.click(await screen.findByRole("button", { name: "Start listening" }));
  expect(listen).toHaveBeenCalledWith("4");
});

test("a series with very many gaps names them instead, and a finished one offers nothing to continue", async () => {
  next = { titleId: null, title: null, medium: null, state: null };
  api.mockImplementation(async () => ({ items: [row("1", "First", "Long", 1), row("30", "Thirtieth", "Long", 30)], total: 2, page: 0, size: 200 }));
  at("/series/Long", "/series/:name", <SeriesPage />);
  expect((await screen.findByTestId("missing")).textContent).toContain("#2, #3");
  expect(screen.queryByTestId("missing-book")).toBeNull();
  expect(await screen.findByTestId("all-finished")).toBeTruthy();
});

test("the title page rows leave out the open title and hide when nothing else is there", async () => {
  const t: Title = { id: "2", title: "Second", authors: ["Ada Author"], series: ["The Saga"], languages: [], editionCount: 1, recordingCount: 0 };
  at("/titles/2", "/titles/:id", <RelatedRows title={t} />);
  const series = await screen.findByTestId("related-series");
  expect(within(series).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/titles/1", "/titles/4"]);
  const author = await screen.findByTestId("related-author");
  expect(within(author).queryByRole("link", { name: /Second/ })).toBeNull();
  cleanup();

  api.mockImplementation(async () => ({ items: [row("2", "Second", "The Saga", 2)], total: 1, page: 0, size: 200 }));
  at("/titles/2", "/titles/:id", <RelatedRows title={t} />);
  await vi.waitFor(() => expect(api).toHaveBeenCalled());
  expect(screen.queryByTestId("related-series")).toBeNull();
  expect(screen.queryByTestId("related-author")).toBeNull();
});

test("a series page shows its saved description and facts", async () => {
  at("/series/The%20Saga", "/series/:name", <SeriesPage />);
  expect((await screen.findByTestId("description")).textContent).toBe("Five parishes.");
  expect(screen.getByTestId("progress").textContent).toBe("3 of 6 in your libraries0 finishedOngoing series status");
});

test("an administrator edits against the loaded revision, and a locked field is read-only", async () => {
  admin = true;
  at("/authors/Ada%20Author?tab=edit", "/authors/:name", <AuthorPage />);
  const fields = await screen.findByTestId("directory-fields");
  expect(screen.getByRole("tab", { name: "Edit author" }).getAttribute("aria-selected")).toBe("true");
  expect((within(fields).getByRole("button", { name: "Biography is locked" }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(screen.getByTestId("field-last_name")).getByText("Guessed")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reset Last name to the guess" })).toBeNull();

  const saved = authorDetails();
  saved.revision = "5";
  saved.fields[0] = field("last_name", "Authorson", "user");
  api.mockImplementation(async (method: string) => (method === "PATCH" ? saved : { items: SAGA, total: 3, page: 0, size: 200 }) as never);
  fireEvent.click(within(fields).getByRole("button", { name: "Edit Last name" }));
  expect(within(screen.getByTestId("field-last_name")).queryByRole("button", { name: "Leave empty" })).toBeNull();
  fireEvent.change(within(screen.getByTestId("field-last_name")).getByRole("textbox"), { target: { value: " Authorson " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Reset Last name to the guess" });
  expect(api).toHaveBeenCalledWith("PATCH", "/authors/details?name=Ada+Author", {
    operationId: expect.any(String), baseRevision: "4", changes: [{ field: "last_name", action: "set", clear: false, value: "Authorson" }],
  });

  fireEvent.click(screen.getByRole("button", { name: "Lock photo" }));
  await vi.waitFor(() => expect(api).toHaveBeenCalledWith("PATCH", "/authors/details?name=Ada+Author", {
    operationId: expect.any(String), baseRevision: "5", changes: [{ field: "photo", action: "lock" }],
  }));
});

test("an out-of-date edit says so and reloads", async () => {
  admin = true;
  at("/authors/Ada%20Author?tab=edit", "/authors/:name", <AuthorPage />);
  await screen.findByTestId("directory-fields");
  api.mockImplementation(async (method: string) => {
    if (method === "PATCH") throw new ApiError(409, { code: "stale_revision" } as never);
    return { items: SAGA, total: 3, page: 0, size: 200 } as never;
  });
  const loads = () => get.mock.calls.filter(([p]) => p.startsWith("/authors/details")).length;
  const before = loads();
  fireEvent.click(screen.getByRole("button", { name: "Lock Last name as it is" }));
  expect((await screen.findByRole("alert")).textContent).toContain("changed elsewhere");
  await vi.waitFor(() => expect(loads()).toBeGreaterThan(before));
});

test("a locked photo offers no way to replace it", async () => {
  admin = true;
  const locked = authorDetails();
  locked.photo = { source: "url", version: "v2", locked: true };
  details = locked;
  at("/authors/Ada%20Author?tab=edit", "/authors/:name", <AuthorPage />);
  await screen.findByTestId("photo-tools");
  expect((screen.getByRole("button", { name: "Remove photo" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Use this address" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("img", { name: "Photo of Ada Author" }).querySelector("img")!.getAttribute("src")).toContain("v=v2");
});

test("a matched series shows the books the libraries lack, labelled and credited, instead of bare numbers", async () => {
  missingBooks = {
    match: { provider: "hardcover", name: "The Saga", url: "https://hardcover.app/series/saga" },
    items: [{ number: 5, title: "Fifth", authors: ["Ada Author"], released: "2021-03-04", url: "https://hardcover.app/books/fifth", coverVersion: "c1" },
      { number: 6, title: "Sixth", authors: [], released: "2022", url: "", coverVersion: null }],
  };
  at("/series/The%20Saga", "/series/:name", <SeriesPage />);
  const absent = await screen.findAllByTestId("missing-member");
  expect(screen.queryByTestId("missing-book")).toBeNull(); // the gap at 3 is not on the provider's missing list
  expect(absent.map((a) => a.textContent)).toEqual([
    "Not in your librariesFifthFirst published 2021About this book on Hardcover",
    "SixthNot in your librariesSixthFirst published 2022About this book on Hardcover",
  ]);
  expect(absent[0]!.querySelector("img")!.getAttribute("src")).toBe("/api/v1/series/missing/cover?name=The+Saga&number=5&v=c1");
  expect(within(absent[0]!).getByRole("link").getAttribute("href")).toBe("https://hardcover.app/books/fifth");
  expect(within(absent[1]!).queryByRole("link")).toBeNull(); // no address, so nothing to link
});

test("provider values are credited with a link", async () => {
  const applied = authorDetails();
  applied.photo = { source: "provider", version: "v3", locked: false, provider: "hardcover", providerUrl: "https://hardcover.app/authors/ada" } as never;
  applied.fields[2] = { ...field("biography", "Born by the sea."), provider: "open_library", providerUrl: "https://openlibrary.org/authors/OL1A" } as never;
  details = applied;
  at("/authors/Ada%20Author", "/authors/:name", <AuthorPage />);
  expect((await screen.findByRole("link", { name: "Hardcover" })).getAttribute("href")).toBe("https://hardcover.app/authors/ada");
  expect(screen.getByRole("link", { name: "Open Library" }).getAttribute("href")).toBe("https://openlibrary.org/authors/OL1A");
});

const results = {
  enabled: true,
  results: [{ provider: "hardcover", status: "ok", candidates: [{ id: "5", name: "Ada Author", url: "https://hardcover.app/authors/ada", detail: "2 works listed", biography: "From the provider.", hasPhoto: true }] }],
};

test("a lookup is reviewed value by value; Use all leaves saved and locked fields", async () => {
  admin = true;
  api.mockImplementation(async (_m: string, p: string) => (p.startsWith("/authors/lookup/apply") ? authorDetails() : p.startsWith("/authors/lookup") ? results : { items: SAGA, total: 3, page: 0, size: 200 }) as never);
  at("/authors/Ada%20Author?tab=edit", "/authors/:name", <AuthorPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Find author online" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  expect(api).toHaveBeenCalledWith("POST", "/authors/lookup?name=Ada+Author", {});
  expect((screen.getByRole("button", { name: "Apply 0 selected" }) as HTMLButtonElement).disabled).toBe(true); // nothing is ticked in advance
  expect(screen.getByRole("img", { name: "Photo offered by Hardcover" }).getAttribute("src")).toBe("/api/v1/authors/lookup/photo?name=Ada+Author&provider=hardcover&id=5");

  fireEvent.click(screen.getByRole("button", { name: "Use all" })); // the biography is locked, so only the photo
  fireEvent.click(screen.getByRole("button", { name: "Apply 1 selected" }));
  await vi.waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/authors/lookup/apply?name=Ada+Author",
    { operationId: expect.any(String), baseRevision: "4", provider: "hardcover", candidateId: "5", fields: [], photo: true }));
});

test("a lookup with no provider turned on says what to do", async () => {
  admin = true;
  api.mockImplementation(async (_m: string, p: string) => (p.startsWith("/series/lookup") ? { enabled: false, results: [] } : { items: SAGA, total: 3, page: 0, size: 200 }) as never);
  at("/series/The%20Saga?tab=edit", "/series/:name", <SeriesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Find series online" }));
  expect((await screen.findByTestId("lookup-results")).textContent).toContain("Turn one on in the library settings");
});
