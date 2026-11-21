import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Spotlight } from "./Spotlight";
import { ThemeProvider } from "./ThemeProvider";

const get = vi.fn(async (path: string) => {
  if (path.startsWith("/libraries")) return { items: [{ id: "L1", name: "Fantasy Library" }] };
  if (path.startsWith("/shelves")) return { items: path.includes("mine") ? [{ id: "S1", deleted: false, visibleTitleCount: 3, data: { name: "Winter reads", kind: "manual" } }] : [] };
  if (path.startsWith("/admin/users")) return { items: [{ id: "U1", username: "reader1", displayName: "Reader One", isAdmin: false, active: true }] };
  if (path.startsWith("/titles")) return { items: [{ id: "T1", title: "The Hobbit", authors: ["Tolkien"], series: [], editionCount: 1, recordingCount: 1 }] };
  return { items: [] };
});
vi.mock("../api/client", () => ({ get: (p: string) => get(p), qs: (o: Record<string, unknown>) => "?" + new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString() }));
vi.mock("../auth/session", () => ({ useAuth: () => ({ user: { isAdmin: true }, logout: async () => undefined }) }));

beforeEach(() => { localStorage.clear(); get.mockClear(); });
afterEach(cleanup);

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider><MemoryRouter><Spotlight /></MemoryRouter></ThemeProvider>
    </QueryClientProvider>,
  );
}
const input = () => screen.findByRole("combobox", { name: "Search everything", hidden: true });

test("the top bar shows a search button with the shortcut key", () => {
  setup();
  const trigger = screen.getByTestId("search-trigger");
  expect(trigger.textContent).toContain("Search everything");
  expect(trigger.querySelector("kbd")).not.toBeNull();
});

test("opens from the button and lists sections before typing", async () => {
  setup();
  fireEvent.click(screen.getByTestId("search-trigger"));
  await input();
  expect(await screen.findByText("Fantasy Library", {}, { timeout: 2000 })).toBeTruthy();
  expect(screen.getByText("Winter reads")).toBeTruthy();
  expect(screen.getByText("Go to")).toBeTruthy();
});

test("typing searches books, settings and people in their own sections", async () => {
  setup();
  fireEvent.click(screen.getByTestId("search-trigger"));
  fireEvent.change(await input(), { target: { value: "hobbit" } });
  expect(await screen.findByText("The Hobbit", {}, { timeout: 2000 })).toBeTruthy();
  expect(screen.getByText("Books and audiobooks")).toBeTruthy();
  fireEvent.change(await input(), { target: { value: "smtp" } });
  expect(await screen.findByText("Pages and settings")).toBeTruthy();
  expect(screen.getByText("Email")).toBeTruthy();
  fireEvent.change(await input(), { target: { value: "reader one" } });
  expect(await screen.findByText("Users")).toBeTruthy();
});
