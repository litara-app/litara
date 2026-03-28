---
sidebar_position: 6
---

# Metadata Enrichment

Litara can automatically fill in missing metadata (title, authors, description, ISBN, genres, and more) by querying external providers. This page covers how to configure which providers supply each field and how to run bulk enrichment across your library.

:::note Admin only
All metadata enrichment settings and bulk runs are available to admin users only, via **Admin Settings → Metadata**.
:::

## Metadata Sources

The **Metadata Sources** card shows every configured provider and lets you enable or disable them individually.

| Provider         | Notes                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| **Open Library** | Free, no key required. Used as the primary ISBN-13 source.                                              |
| **Google Books** | Free with rate limits (~100 req/day). Set `GOOGLE_BOOKS_API_KEY` in your environment for 1,000 req/day. |
| **Hardcover**    | Requires `HARDCOVER_API_KEY`. See [Configuration](./configuration.md#hardcover-api-key).                |
| **Goodreads**    | Community ratings and IDs.                                                                              |

Disabling a provider automatically reassigns any field mappings that were using it to the next available enabled provider.

Use the **Test** button (visible on providers that require an API key) to verify your key is working.

## Field Sources

The **Field Sources** card lets you choose which provider supplies each metadata field during bulk enrichment.

**ISBN-13 is always resolved first.** Open Library resolves the ISBN-13 for each book, and that value is automatically passed as a lookup hint to every subsequent provider — improving match accuracy for Hardcover, Google Books, and others.

For every other field you can:

- **Choose the provider** — select from the dropdown next to the field name.
- **Disable the field** — toggle it off to skip it entirely during enrichment (existing data is left unchanged).

Click **Save Configuration** when you're done.

## Request Throttle

The **Request Throttle** setting controls the delay (in milliseconds) inserted between consecutive API calls. The default is 500 ms. Increase it if you are hitting rate limits; lower it carefully if your API keys have generous limits.

Range: 50–5000 ms.

## Running Bulk Enrichment

The **Run Bulk Enrichment** card lets you kick off a metadata run across your library.

### Options

| Option                        | Description                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**                     | Run on **All Books**, a specific **Library**, or a specific **Shelf**.                                                                                                                                                        |
| **Overwrite existing values** | By default, only empty fields are filled. Enable this to replace existing values with whatever the provider returns.                                                                                                          |
| **Guided mode**               | For runs of 50 books or fewer, Litara fetches the top 3 Open Library candidates for each ambiguous book and lets you pick the correct edition before the run starts. Disable this to always use the top result automatically. |

### Guided Disambiguation

When guided mode is on and your run scope has 50 or fewer books, a disambiguation dialog appears for any book that has multiple strong matches in Open Library. For each ambiguous book you can:

- Click a candidate card to select it (cover, title, authors, year, and ISBN-13 are shown).
- Click **Skip** to accept the top result without choosing.
- Use **Back** and **Next** to navigate between books.
- Click **Start Run** on the last book to submit.

### Tracking progress

After clicking **Run Bulk Enrichment**, the run is submitted as a background job and you are switched to the **Tasks** tab automatically.

The Tasks tab shows all recent enrichment runs with live progress updates:

- A progress bar showing books processed vs. total.
- The current status: **Pending**, **Processing**, **Completed**, **Failed**, or **Cancelled**.
- A **Cancel** button to stop an in-progress run cleanly (the current book finishes before the run stops).
