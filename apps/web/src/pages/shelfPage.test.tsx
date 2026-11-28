import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ShelfPage } from "./ShelfPage";

// A fake shelf that pages like the server: at most 200 titles a request, and a new order only as the complete list.
let ids: string[] = [];
let kind = "manual";
let canEdit = true;
let failPage = -1;
let asked: number[] = [];
let orders: string[][] = [];

const get = vi.fn(async (path: string): Promise<unknown> => {
  if (path === "/shelves/S1") {
    return { id: "S1", revision: "1", canEdit, deleted: false, visibleTitleCount: ids.length, data: { name: "Long shelf", kind, visibility: "private", filter: null } };
  }
  const url = new URL(path, "http://test");
  const page = Number(url.searchParams.get("page")), size = Number(url.searchParams.get("size"));
  expect(size).toBe(200);
  asked.push(page);
  if (page === failPage) throw new Error("The server is unavailable");
  const items = ids.slice(page * size, (page + 1) * size).map((id) => ({ id, title: `Book ${id}`, authors: [] }));
  return { items, total: ids.length, page, size };
});
const api = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
  if (method === "DELETE") ids = ids.filter((id) => !path.endsWith(`/titles/${id}`));
  if (method === "PUT") { ids = (body as { visibleTitleIds: string[] }).visibleTitleIds; orders.push(ids); }
  return {};
});
// There is no layout here, so the real list can only draw its first rows. These tests are about which titles are loaded
// and in what order, so the list draws them all; the last test uses the real one.
let windowed = false;
vi.mock("../ui/virtual", async (orig) => {
  const real = await orig<typeof import("../ui/virtual")>();
  return {
    ...real,
    VirtualList: <T,>(p: Parameters<typeof real.VirtualList<T>>[0]) => (windowed ? <real.VirtualList {...p} />
      : <>{p.items.map((t, i) => <div key={p.getKey(t)}>{p.render(t, i)}</div>)}</>),
  };
});

vi.mock("../api/client", async (orig) => ({ ...(await orig<object>()), get: (p: string) => get(p), api: (m: string, p: string, b?: unknown) => api(m, p, b) }));

const make = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
beforeEach(() => { windowed = false; kind = "manual"; canEdit = true; failPage = -1; asked = []; orders = []; });
afterEach(cleanup);

function setup(count: number) {
  ids = make(count);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/shelves/S1"]}><Routes><Route path="/shelves/:shelfId" element={<ShelfPage />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}
const rows = () => screen.queryAllByTestId("shelf-title");
const shows = (n: number) => waitFor(() => expect(rows()).toHaveLength(n), { timeout: 10_000 });
const button = (name: string) => screen.queryByText(name)?.closest("button") ?? null;
const arrow = (name: string) => screen.getByLabelText(name) as HTMLButtonElement;

test("a shelf that fits in one request has no extra controls and can be reordered", async () => {
  setup(3);
  await shows(3);
  expect(button("Show more")).toBeNull();
  expect(button("Load all to reorder")).toBeNull();
  expect(arrow("Move Book 1 down").disabled).toBe(false);
});

test("a long shelf shows one batch, and the order stays locked until every title is loaded", async () => {
  setup(450);
  await shows(200);
  expect(screen.getByTestId("shelf-shown").textContent).toBe("Showing 200 of 450 titles");
  expect(arrow("Move Book 2 up").disabled).toBe(true);
  expect(arrow("Move Book 2 down").disabled).toBe(true);

  fireEvent.click(button("Show more")!);
  await shows(400);
  expect(arrow("Move Book 2 down").disabled).toBe(true);
  expect(asked).toEqual([0, 1]);
}, 60_000);

test("load all to reorder fetches the rest, sends the whole order and keeps the list loaded", async () => {
  setup(450);
  await shows(200);
  fireEvent.click(button("Load all to reorder")!);
  await shows(450);
  expect(asked).toEqual([0, 1, 2]);
  expect(button("Show more")).toBeNull();
  expect(button("Load all to reorder")).toBeNull();

  fireEvent.click(arrow("Move Book 450 up"));
  await waitFor(() => expect(orders).toHaveLength(1));
  expect(orders[0]).toHaveLength(450);
  expect(orders[0].slice(-3)).toEqual(["448", "450", "449"]);
  await waitFor(() => expect(rows()[448].textContent).toContain("Book 450"), { timeout: 10_000 });
  expect(rows()).toHaveLength(450);
}, 60_000);

test("removing a title keeps every batch already shown", async () => {
  setup(450);
  await shows(200);
  fireEvent.click(button("Show more")!);
  await shows(400);
  asked = [];
  fireEvent.click(rows()[300].querySelector("button:last-of-type") as HTMLButtonElement);
  await waitFor(() => expect(screen.getByTestId("shelf-shown").textContent).toBe("Showing 400 of 449 titles"), { timeout: 10_000 });
  expect(screen.queryByText("Book 301")).toBeNull();
  expect(asked).toEqual([0, 1]);
}, 60_000);

test("a batch that fails is reported, keeps what is shown and can be asked for again", async () => {
  setup(450);
  await shows(200);
  failPage = 1;
  fireEvent.click(button("Load all to reorder")!);
  expect(await screen.findByText(/The server is unavailable/)).toBeTruthy();
  expect(rows()).toHaveLength(200);
  await waitFor(() => expect(button("Load all to reorder")!.disabled).toBe(false));
  expect(asked).toEqual([0, 1]); // it stopped; it did not keep asking

  failPage = -1;
  fireEvent.click(button("Load all to reorder")!);
  await shows(450);
  expect(screen.queryByText(/The server is unavailable/)).toBeNull();
}, 60_000);

test("a first request that fails is an error, not an empty shelf", async () => {
  failPage = 0;
  setup(3);
  expect(await screen.findByText(/The server is unavailable/)).toBeTruthy();
  expect(screen.queryByText("No visible titles")).toBeNull();
});

test("a long smart shelf offers more titles but no reordering", async () => {
  kind = "smart";
  canEdit = false;
  setup(250);
  await shows(200);
  expect(button("Load all to reorder")).toBeNull();
  fireEvent.click(button("Show more")!);
  await shows(250);
  expect(button("Show more")).toBeNull();
}, 60_000);

test("only some of a long shelf's rows are drawn, each with its place in the list", async () => {
  windowed = true;
  setup(450);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0), { timeout: 10_000 });
  expect(rows().length).toBeLessThan(200);
  const drawn = screen.getAllByRole("listitem").filter((e) => e.hasAttribute("aria-posinset"));
  expect(drawn[0]!.getAttribute("aria-posinset")).toBe("1");
  expect(drawn[0]!.getAttribute("aria-setsize")).toBe("200");
  expect(screen.getByTestId("shelf-shown").textContent).toBe("Showing 200 of 450 titles");
});
