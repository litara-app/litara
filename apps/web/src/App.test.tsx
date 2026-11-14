import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";

test("renders the application shell", () => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  render(<MantineProvider><App /></MantineProvider>);
  expect(screen.getByRole("heading", { name: "Litara" })).toBeTruthy();
});
