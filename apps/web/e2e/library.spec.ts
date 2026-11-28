import { expect, test } from "@playwright/test";

// The library table draws only the rows near the screen and works out which from a fixed row height (ADR-0084), so a
// row that grows taller breaks scrolling as well as the look. A style meant for another picture once did that to the
// table's covers, and only a real browser applies the styles.

const ROW_HEIGHT = 56;

test("library table rows keep their fixed height, with small covers inside them", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/Username/).fill("fixture-user-a");
  await page.getByLabel(/Password/).fill("synthetic-fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("whoami")).toBeAttached();

  await page.goto("/?view=table");
  const rows = page.getByTestId("title-item");
  await expect(rows.first()).toBeVisible();
  const sizes = await rows.evaluateAll((all) => all.map((row) => {
    const box = (e: Element) => e.getBoundingClientRect();
    return { row: box(row).height, cover: box(row.querySelector(".lt-cover")!).height, width: box(row.querySelector(".lt-cover")!).width };
  }));
  for (const s of sizes) {
    expect(Math.abs(s.row - ROW_HEIGHT)).toBeLessThanOrEqual(1.5);
    expect(s.cover).toBeLessThan(ROW_HEIGHT);
    expect(s.width).toBeLessThanOrEqual(30);
  }
});
