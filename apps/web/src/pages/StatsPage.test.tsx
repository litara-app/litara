import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { level, readingTime, StatsPage } from "./StatsPage";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const daysAgo = (n: number) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));

const get = vi.fn(async (_p: string): Promise<unknown> => ({
  from: daysAgo(364), to: daysAgo(0), timeZone: "Europe/Berlin", readingDaySeconds: 300,
  days: [
    { date: daysAgo(2), activeSeconds: 120, sessions: 1, readingDay: false },
    { date: daysAgo(1), activeSeconds: 2400, sessions: 2, readingDay: true },
    { date: daysAgo(0), activeSeconds: 4000, sessions: 1, readingDay: true },
  ],
  activeSeconds: 6520, readingDays: 2, sessions: 4, books: 3, currentStreak: 2, longestStreak: 5,
  activity: [
    { date: daysAgo(3), readingSeconds: 0, readingSessions: 0, listeningSeconds: 900, listeningSessions: 1, readingDay: true },
    { date: daysAgo(2), readingSeconds: 120, readingSessions: 1, listeningSeconds: 0, listeningSessions: 0, readingDay: false },
    { date: daysAgo(1), readingSeconds: 2400, readingSessions: 2, listeningSeconds: 0, listeningSessions: 0, readingDay: true },
    { date: daysAgo(0), readingSeconds: 4000, readingSessions: 1, listeningSeconds: 600, listeningSessions: 1, readingDay: true },
  ],
  listeningSeconds: 1500, listeningSessions: 2, listenedBooks: 1,
}));
vi.mock("../api/client", async (orig) => ({ ...(await orig<object>()), get: (p: string) => get(p) }));
afterEach(cleanup);

test("reading time and heatmap steps follow ADR-0098's 5-minute reading day", () => {
  expect(readingTime(45 * 60)).toBe("45 min");
  expect(readingTime(200 * 60)).toBe("3 h 20 min");
  expect(readingTime(7200)).toBe("2 h");
  expect([0, 60, 299, 300, 1799, 1800, 3599, 3600].map((s) => level(s, 300))).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
});

test("the stats page asks for the last year in the browser's time zone and shows totals, streaks and a heatmap", async () => {
  render(<QueryClientProvider client={new QueryClient()}><StatsPage /></QueryClientProvider>);
  const tiles = await screen.findByTestId("stat-tiles");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(get).toHaveBeenCalledWith(`/stats/reading?from=${daysAgo(364)}&to=${daysAgo(0)}&timeZone=${encodeURIComponent(zone)}`);
  for (const text of ["1 h 49 min", "Time read", "25 min", "Time listened", "2 h 14 min", "Total time", "2 days", "Current streak", "5 days", "Longest streak", "3", "Books read", "1", "Book listened to", "6", "Sessions"]) {
    expect(within(tiles).getAllByText(text).length).toBeGreaterThan(0);
  }
  expect(screen.getByTestId(`heat-${daysAgo(0)}`).getAttribute("data-level")).toBe("4");
  expect(screen.getByTestId(`heat-${daysAgo(1)}`).getAttribute("data-level")).toBe("3");
  expect(screen.getByTestId(`heat-${daysAgo(2)}`).getAttribute("data-level")).toBe("1"); // under a reading day
  expect(screen.getByTestId(`heat-${daysAgo(3)}`).getAttribute("data-level")).toBe("2"); // listening alone shows
  expect(screen.getByTestId(`heat-${daysAgo(4)}`).getAttribute("data-level")).toBe("0");
  expect(screen.getAllByTestId(/^heat-/)).toHaveLength(365);
  fireEvent.pointerEnter(screen.getByTestId(`heat-${daysAgo(1)}`));
  expect(screen.getByText(/40 min read/)).toBeTruthy(); // the hover readout

  fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
  const rows = within(screen.getByTestId("stats-table")).getAllByRole("row");
  expect(rows).toHaveLength(5); // header plus the four days, newest first
  expect(rows[1]!.textContent).toMatch(/1 h 7 min10 min1 h 17 min2Yes/);
  expect(rows[3]!.textContent).toMatch(/2 min.*No/);
  expect(rows[4]!.textContent).toMatch(/0 min15 min15 min1Yes/);
});

test("the table shows 25 days at a time, newest first, and pages through the rest", async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ date: daysAgo(59 - i), activeSeconds: 600, sessions: 1, readingDay: true }));
  get.mockResolvedValueOnce({
    from: daysAgo(364), to: daysAgo(0), timeZone: "Europe/Berlin", readingDaySeconds: 300,
    days: many, activeSeconds: 36000, readingDays: 60, sessions: 60, books: 1, currentStreak: 60, longestStreak: 60,
    activity: many.map((d) => ({ date: d.date, readingSeconds: 600, readingSessions: 1, listeningSeconds: 0, listeningSessions: 0, readingDay: true })),
    listeningSeconds: 0, listeningSessions: 0, listenedBooks: 0,
  });
  render(<QueryClientProvider client={new QueryClient()}><StatsPage /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Show as table" }));
  const rows = () => within(screen.getByTestId("stats-table")).getAllByRole("row").slice(1);
  const first = rows()[0]!.textContent;
  expect(rows()).toHaveLength(25);
  fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
  expect(rows()).toHaveLength(10);
  expect(rows()[0]!.textContent).not.toBe(first);
});
