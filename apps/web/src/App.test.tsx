import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "./App";

test("renders the application shell", () => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  render(<MantineProvider><MemoryRouter><App /></MemoryRouter></MantineProvider>);
  expect(screen.getByRole("heading", { name: "Litara" })).toBeTruthy();
});
