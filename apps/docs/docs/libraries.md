---
sidebar_position: 4
---

# Libraries

A **library** is a named folder on disk that Litara watches and indexes. You can have multiple libraries — for example, one for ebooks and one for audiobooks — each with its own icon, metadata provider settings, and book collection.

:::note Admin only
Creating, editing, and deleting libraries requires an admin account.
:::

## Creating a library

1. In the sidebar, expand **Libraries** and click **New Library** (visible to admins only).
2. Fill in the form:

| Field                           | Description                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Library Name**                | Display name shown in the sidebar and throughout the app.                                                                                                                                     |
| **Folder Path**                 | The absolute path to the folder on disk, or use **Browse** to pick a subfolder of your library root. The path must be under `EBOOK_LIBRARY_PATH` and cannot overlap with an existing library. |
| **Icon**                        | Choose an icon from the visual picker to identify this library at a glance.                                                                                                                   |
| **Disabled Metadata Providers** | Providers selected here will be skipped when enriching books in this library. Leave empty to inherit global provider settings.                                                                |

3. Click **Create Library**. An initial scan starts automatically to import any existing files in the folder.

## Library icons

Each library can have an icon chosen from a curated set of Tabler icons. The icon appears in the sidebar next to the library name (web) and in the library selector tabs (mobile).

To set or change an icon, open the library's **Settings** (gear icon on the library page) and select an icon from the picker. Choose the **✕** option to display no icon (the sidebar will fall back to a generic library icon).

## Editing a library

Open a library page and click the **Settings** icon in the page header. From the settings modal you can:

- **Rename** the library
- **Change the icon**
- View the **folder path** (read-only after creation)

Click **Save** to apply changes.

## Rescanning

Click the **Rescan** button (circular arrow icon) on a library page to trigger a fresh scan of the watched folder. This picks up any files that were added, modified, or removed since the last scan. A progress indicator shows while the scan is running.

Litara also watches the folder continuously with a file-system watcher, so newly added or deleted files are typically reflected in near real-time without a manual rescan.

## Deleting a library

Open the library's **Settings** modal and click **Delete Library**. You will be asked to confirm — this removes the library and all its books from the database. **Files on disk are not deleted.**
