import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "../api/client";
import { ErrorBox } from "./feedback";
import { currentNotices, notify, NotificationBell, NotificationHost, notifyError, useNotices } from "./notify";

vi.mock("../auth/session", () => ({ useAuth: () => ({ user: { id: "U1", isAdmin: true } }) }));

function Count() {
  const { items, unread } = useNotices();
  return <span data-testid="count">{items.length}/{unread}</span>;
}

function setup() {
  render(<MemoryRouter><NotificationHost /><NotificationBell /><Count /></MemoryRouter>);
}

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(cleanup);

test("a notification is recorded for the account and an action's own result is already read", () => {
  setup();
  act(() => { notify.success("Saved", { detail: "Title" }); });
  expect(screen.getByTestId("count").textContent).toBe("1/0");
  expect(JSON.parse(localStorage.getItem("litara.notifications.U1")!)[0]).toMatchObject({ title: "Saved", tone: "success", read: true });
});

test("a background notification makes the bell show unread, and opening the bell clears it and lists only the last five", async () => {
  setup();
  act(() => { for (let i = 1; i <= 7; i++) notify.info(`Item ${i}`, { source: "system" }); });
  expect(screen.getByTestId("bell-unread").textContent).toBe("7");
  expect(screen.getByRole("button", { name: "Notifications, 7 unread" })).toBeTruthy();
  fireEvent.click(screen.getByTestId("notification-bell"));
  await waitFor(() => expect(document.querySelector('[aria-label="Latest notifications"]')).toBeTruthy());
  const list = document.querySelector('[aria-label="Latest notifications"]')!;
  expect(list.querySelectorAll("li").length).toBe(5);
  expect(list.textContent).toContain("Item 7");
  expect(list.textContent).not.toContain("Item 2");
  expect(screen.queryByTestId("bell-unread")).toBeNull();
  expect(screen.getByText("All notifications").closest("a")?.getAttribute("href")).toBe("/settings/notifications");
});

test("a failed action is reported once: as a notification, and not again by an error box", () => {
  const err = new ApiError(409, { title: "Conflict", detail: "This changed elsewhere", code: "conflict" } as never);
  act(() => { notifyError(err); });
  expect(currentNotices()[0]).toMatchObject({ tone: "error", title: "Something went wrong" });
  expect(currentNotices()[0]!.detail).toContain("This changed elsewhere");
  const { container } = render(<ErrorBox error={err} />);
  expect(container.querySelector(".lt-alert")).toBeNull();
  const other = render(<ErrorBox error={new Error("a page could not load")} />);
  expect(other.container.querySelector(".lt-alert")).toBeTruthy();
});
