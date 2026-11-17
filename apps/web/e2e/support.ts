import { expect, type Page } from "@playwright/test";

/**
 * Open a title page through search (the library is paged) and wait until it is really open.
 * The list is only trusted once the matching card is present and no other card remains; the
 * navigation is awaited before any further click, because a click made while the previous list
 * is still on screen can land on another title (seen in WebKit, where the search result arrived
 * after the next locator had already matched a stale card).
 */
export async function openTitle(page: Page, title: string) {
  await page.goto("/");
  await page.getByLabel("Search").fill(title);
  const cards = page.getByTestId("title-card");
  await expect(cards.filter({ hasText: title }).first()).toBeVisible({ timeout: 15_000 });
  await expect(cards.filter({ hasNotText: title })).toHaveCount(0, { timeout: 15_000 });
  await cards.filter({ hasText: title }).first().getByText(title, { exact: true }).click();
  await expect(page).toHaveURL(/\/titles\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
}

/** From a title page, open its first EPUB edition and wait for the edition page. */
export async function openEpubEdition(page: Page) {
  await page.getByRole("link", { name: "EPUB", exact: true }).first().click();
  await expect(page).toHaveURL(/\/editions\/[0-9a-f-]+$/);
}
