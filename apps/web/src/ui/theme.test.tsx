import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { AppearancePage } from "../settings/AppearancePage";
import { ThemeProvider, useTheme } from "./ThemeProvider";

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.theme; });
afterEach(cleanup);

test("the Reading Room theme is the default", () => {
  render(<ThemeProvider><AppearancePage /></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe("reading-room");
  expect(screen.getByRole("radio", { name: "Reading Room" }).getAttribute("aria-checked")).toBe("true");
});

test("choosing Clean applies and remembers the theme", () => {
  render(<ThemeProvider><AppearancePage /></ThemeProvider>);
  fireEvent.click(screen.getByRole("radio", { name: "Clean" }));
  expect(document.documentElement.dataset.theme).toBe("clean");
  expect(localStorage.getItem("litara.theme")).toBe("clean");
});

test("a saved choice is used on the next visit", () => {
  localStorage.setItem("litara.theme", "clean");
  render(<ThemeProvider><AppearancePage /></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe("clean");
});

function ModeProbe() {
  const { mode, toggleMode } = useTheme();
  return <button onClick={toggleMode}>mode: {mode}</button>;
}

test("the light/dark toggle forces a mode, applies it to the page and remembers it", () => {
  localStorage.clear();
  delete document.documentElement.dataset.mode;
  render(<ThemeProvider><ModeProbe /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button"));
  expect(document.documentElement.dataset.mode).toBe("dark");
  expect(localStorage.getItem("litara.mode")).toBe("dark");
  fireEvent.click(screen.getByRole("button"));
  expect(document.documentElement.dataset.mode).toBe("light");
});
