---
sidebar_position: 4
---

# OPDS Catalog

Litara exposes an OPDS catalog so ebook reader apps can browse and download books directly. OPDS is disabled by default — enable it in **Settings → OPDS Catalog**.

| Version                   | URL                          | Format   | Compatible apps                    |
| ------------------------- | ---------------------------- | -------- | ---------------------------------- |
| OPDS 1.2                  | `http://<host>:3000/opds/v1` | Atom XML | KOReader, Pocketbook, Moon+ Reader |
| OPDS 2.0 _(experimental)_ | `http://<host>:3000/opds/v2` | JSON     | Thorium Reader                     |

## Authentication

OPDS uses dedicated OPDS credentials — **not** your Litara account login. Create OPDS users in **Settings → OPDS Catalog → Add User**. These accounts can only access the OPDS catalog and cannot log into the Litara web UI.

## App Setup

### KOReader

1. Open **OPDS catalog** → **Add catalog**
2. Enter `http://<host>:3000/opds/v1`
3. Enter your OPDS username and password when prompted

### Thorium Reader

1. Open **Catalogs** → **Add an OPDS feed**
2. Enter `http://<host>:3000/opds/v2`
3. Enter your OPDS username and password when prompted

:::note
OPDS v2.0 support is experimental. Client compatibility varies. Please [open an issue](https://github.com/litara-app/litara/issues) if you encounter problems.
:::

## Available Feeds

### OPDS v1 (Atom XML)

| Endpoint                            | Description                    |
| ----------------------------------- | ------------------------------ |
| `/opds/v1`                          | Root navigation                |
| `/opds/v1/catalog`                  | All books (paginated, 20/page) |
| `/opds/v1/new`                      | New arrivals                   |
| `/opds/v1/search/results?q=…`       | Search by title or author      |
| `/opds/v1/authors`                  | Browse by author               |
| `/opds/v1/series`                   | Browse by series               |
| `/opds/v1/genres`                   | Browse by genre                |
| `/opds/v1/download/:bookId/:fileId` | Download a file                |

### OPDS v2 (JSON)

| Endpoint   | Description     |
| ---------- | --------------- |
| `/opds/v2` | Root navigation |
