---
sidebar_position: 8
---

# Series

The Series page lets you browse every series in your library, see how complete your collection is, and discover which books you're missing.

## Browsing Series

Navigate to **Series** in the sidebar to open the series list. Each card shows:

- A stacked cover preview using up to 3 books from the series
- The series name and primary author(s)
- An owned/total progress indicator (e.g. **3 of 5** or **3 books** if the total is unknown)

Click a series card to open the **Series Detail** page.

## Series Detail Page

The Series Detail page shows all books in the series as a scrollable strip at the bottom of the page, sorted by sequence number. It also displays:

- Series statistics: year range, total pages, publishers, and formats
- An author panel with biography and photo for each author in the series

### Owned vs. Missing Books

Books you own appear as normal cover cards. Books that are in the series but **not in your library** appear as **ghost cards** — desaturated with a "Not in library" badge. Ghost cards are interleaved with your owned books in sequence order so you can see exactly where the gaps are.

Clicking a ghost card opens a small popover showing the book's title and authors, with a **Copy title & author** button that copies `"<title> by <author(s)>"` to your clipboard — handy for quickly looking up or purchasing a missing book.

### Library Only Toggle

Use the **Library only** toggle in the page header to hide ghost cards and show only the books you own.

### Fetching the Complete Series

Click **Fetch Complete Series** in the page header to pull the full series roster from a metadata provider (Hardcover if configured, otherwise Goodreads). Litara will:

1. Query the provider for every book in the series by name
2. Create ghost cards for any positions not already in your library
3. Download and store cover images for each missing book
4. Update the series' expected total book count

The page reloads automatically when enrichment finishes. If enrichment fails (e.g. the provider returned no results), an error notification is shown.

:::note Provider requirements
Hardcover enrichment requires `HARDCOVER_API_KEY` to be set. Goodreads enrichment requires at least one book in the series to have a Goodreads ID — enrich your books first if slots are not appearing.
:::

### Auto-resolving Ghost Cards

When you add a book to your library and Litara matches it to a series position that had a ghost card, the ghost card is automatically removed and replaced by your owned book card.

## Bulk Series Enrichment

To enrich all series in your library at once:

1. Go to **Admin Settings → Metadata**.
2. Scroll to the **Series Enrichment** section.
3. Click **Enrich All Series**.

This creates a background task that works through every series sequentially. Progress is visible in the **Tasks** tab — the task payload shows total series count, how many have been completed, and how many failed.

Individual series failures (e.g. no provider match found) are counted and do not abort the overall task.

:::note Admin only
Bulk series enrichment is available to admin users only.
:::
