import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SearchField } from "./controls";

afterEach(cleanup);
const box = () => screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement;

// A redraw with the old value must not write over the box: when React runs one while a keystroke is being handled, an
// input that is written on every redraw loses the keystroke before the app hears of it.
test("a redraw with the old value leaves what was typed, and a value from elsewhere is shown", () => {
  const onValue = vi.fn();
  const view = render(<SearchField label="Search" value="" onValue={onValue} />);
  fireEvent.change(box(), { target: { value: "damaged" } });
  expect(onValue).toHaveBeenLastCalledWith("damaged");
  view.rerender(<SearchField label="Search" value="" onValue={onValue} />); // the caller has not caught up
  expect(box().value).toBe("damaged");
  view.rerender(<SearchField label="Search" value="damaged" onValue={onValue} />);
  view.rerender(<SearchField label="Search" value="from the top bar" onValue={onValue} />);
  expect(box().value).toBe("from the top bar");
  view.rerender(<SearchField label="Search" value="" onValue={onValue} />);
  expect(box().value).toBe("");
});
