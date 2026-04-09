---
sidebar_position: 6
---

# KOReader Sync

Litara can act as a KOReader progress sync server, allowing KOReader to save and restore your reading position across devices without needing to run a separate sync service.

KOReader sync is **disabled by default**. Enable it in **Admin Settings → General → KOReader Sync**.

## Setup

### 1. Enable KOReader sync (admin)

1. Open **Admin Settings → General**.
2. Find the **KOReader Sync** section and toggle it on.
3. Copy the **sync server URL** shown (e.g. `http://192.168.1.100:3000/1`).

### 2. Create your sync credentials

Each Litara user must create their own KOReader credentials before syncing.

1. Open **Settings** (from the sidebar).
2. Scroll to the **KOReader Sync** section.
3. Enter a username and password, then click **Save credentials**.

:::note
These are separate from your Litara login. The username must not contain colons (`:`).
:::

### 3. Configure KOReader

1. In KOReader, go to **Tools → Progress Sync → Custom sync server**.
2. Set the **Custom sync server** URL to the value copied from step 1.
3. In KOReader, go to **Tools → Progress Sync → Register / Login**.
4. Enter the username and password you created in step 2.
5. Tap **Login**.

KOReader will now sync your reading position to Litara automatically.

## How progress syncing works

When you read in KOReader and sync, Litara stores your reading position and percentage. The next time KOReader syncs (on the same or another device), it picks up where you left off.

### Reading position compatibility

Litara's web reader and KOReader use **different position formats** that are not interchangeable:

| Client            | Position format                                                               |
| ----------------- | ----------------------------------------------------------------------------- |
| KOReader          | Internal XPath string (e.g. `/body/DocFragment[5]/body/div/p[34]/text().217`) |
| Litara web reader | EPUB CFI (e.g. `epubcfi(/6/4!/4/10/2:3)`)                                     |

Because of this:

- **Percentage** is synced between KOReader and the Litara web reader. Both will show the same approximate progress (e.g. 42%).
- **Exact position** is not shared. If you sync from KOReader and then open the book in the Litara web reader, it will not open at the exact same paragraph — the web reader has no record of where you were in CFI terms.
- **For consistent exact-position sync across devices, read only in KOReader.** KOReader's own cross-device sync works at the exact position level since all devices use the same format.

## MD5 hash backfill

KOReader identifies books by a partial MD5 hash of the file content. When you first enable KOReader sync, run the backfill so Litara can match incoming sync requests to books in your library:

1. Go to **Admin Settings → General → KOReader Sync**.
2. Click **Run MD5 backfill**.

The backfill runs automatically on server startup and when adding new books to Litara, so this button is mainly useful for existing libraries established before this feature was added.

## Troubleshooting

**KOReader says sync failed / no progress found**

- Make sure KOReader sync is enabled in Admin Settings.
- Check that your credentials are correct (Settings → KOReader Sync).
- If you recently imported the book into Litara, run the MD5 backfill (Admin Settings → General → KOReader Sync → Run MD5 backfill).
- Confirm the book was downloaded from your Litara OPDS catalog or manually added to the watched folder — the file on your device must be identical to the one in the library.

**Progress percentage shows in Litara but book doesn't open at the right page in the web reader**

This is expected — see [Reading position compatibility](#reading-position-compatibility) above.
