import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "../api/client";
import { ErrorBox } from "./feedback";
import { currentNotices, notify, NotificationBell, NotificationHost, notifyError, refreshNotifications, useNotices } from "./notify";

type Row = { id: string; tone: string; title: string; detail?: string; source: "user" | "system"; read: boolean; createdAt: string };
const server: { rows: Row[]; calls: [string, string, unknown][] } = { rows: [], calls: [] };

vi.mock("../auth/session", () => ({ useAuth: () => ({ user: { id: "U1", isAdmin: true } }) }));
vi.mock("../api/client", async (orig) => ({
  ...(await orig<object>()),
  get: async (path: string) => {
    server.calls.push(["GET", path, undefined]);
    return { items: server.rows, unread: server.rows.filter((r) => !r.read).length };
  },
  api: async (method: string, path: string, body?: unknown) => {
    server.calls.push([method, path, body]);
    if (method === "POST" && path === "/notifications") {
      const b = body as { tone: string; title: string; detail?: string };
      const row: Row = { id: `S${server.rows.length + 1}`, tone: b.tone, title: b.title, detail: b.detail, source: "user", read: true, createdAt: new Date().toISOString() };
      server.rows = [row, ...server.rows];
      return row;
    }
    if (method === "POST" && path === "/notifications/read") server.rows = server.rows.map((r) => ({ ...r, read: true }));
    if (method === "DELETE") server.rows = [];
    return undefined;
  },
}));

function Count() {
  const { items, unread } = useNotices();
  return <span data-testid="count">{items.length}/{unread}</span>;
}

let clearHistory = () => {};
function Probe() {
  clearHistory = useNotices().clear;
  return null;
}

async function setup() {
  render(<MemoryRouter><NotificationHost /><NotificationBell /><Count /><Probe /></MemoryRouter>);
  await waitFor(() => expect(server.calls.some((c) => c[0] === "GET")).toBe(true));
}

beforeEach(() => { server.rows = []; server.calls = []; });
afterEach(cleanup);

test("the history is loaded from the server at sign-in", async () => {
  server.rows = [{ id: "S1", tone: "info", title: "Earlier", source: "user", read: true, createdAt: "2026-11-22T10:00:00Z" }];
  await setup();
  await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1/0"));
});

test("an action's notification is sent to the server and replaced by the stored entry", async () => {
  await setup();
  act(() => { notify.success("Saved", { detail: "Title" }); });
  expect(screen.getByTestId("count").textContent).toBe("1/0");
  await waitFor(() => expect(server.calls.some((c) => c[0] === "POST" && c[1] === "/notifications")).toBe(true));
  expect(server.calls.find((c) => c[1] === "/notifications" && c[0] === "POST")![2]).toEqual({ tone: "success", title: "Saved", detail: "Title" });
  await waitFor(() => expect(currentNotices()[0]!.id).toBe("S1"));
});

test("a background notification found on refresh makes the bell show unread; opening the bell lists the last five and tells the server", async () => {
  await setup();
  server.rows = Array.from({ length: 7 }, (_, i) => ({ id: `B${7 - i}`, tone: "info", title: `Item ${7 - i}`, source: "system" as const, read: false, createdAt: new Date(Date.now() - i * 1000).toISOString() }));
  await act(async () => { await refreshNotifications(); });
  expect(screen.getByTestId("bell-unread").textContent).toBe("7");
  expect(screen.getByRole("button", { name: "Notifications, 7 unread" })).toBeTruthy();
  fireEvent.click(screen.getByTestId("notification-bell"));
  await waitFor(() => expect(document.querySelector('[aria-label="Latest notifications"]')).toBeTruthy());
  const list = document.querySelector('[aria-label="Latest notifications"]')!;
  expect(list.querySelectorAll("li").length).toBe(5);
  expect(list.textContent).toContain("Item 7");
  expect(list.textContent).not.toContain("Item 2");
  expect(screen.queryByTestId("bell-unread")).toBeNull();
  await waitFor(() => expect(server.calls.some((c) => c[1] === "/notifications/read")).toBe(true));
  expect(screen.getByText("All notifications").closest("a")?.getAttribute("href")).toBe("/settings/notifications");
});

test("clearing the history also clears it on the server", async () => {
  server.rows = [{ id: "S1", tone: "info", title: "Earlier", source: "user", read: true, createdAt: "2026-11-22T10:00:00Z" }];
  await setup();
  await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1/0"));
  act(() => clearHistory());
  await waitFor(() => expect(server.calls.some((c) => c[0] === "DELETE" && c[1] === "/notifications")).toBe(true));
  expect(screen.getByTestId("count").textContent).toBe("0/0");
});

test("a failed action is reported once: as a notification, and not again by an error box", async () => {
  await setup();
  const err = new ApiError(409, { title: "Conflict", detail: "This changed elsewhere", code: "conflict" } as never);
  act(() => { notifyError(err); });
  expect(currentNotices()[0]).toMatchObject({ tone: "error", title: "Something went wrong" });
  expect(currentNotices()[0]!.detail).toContain("This changed elsewhere");
  const { container } = render(<ErrorBox error={err} />);
  expect(container.querySelector(".lt-alert")).toBeNull();
  const other = render(<ErrorBox error={new Error("a page could not load")} />);
  expect(other.container.querySelector(".lt-alert")).toBeTruthy();
});
