---
sidebar_position: 5
---

# Smart Shelves

Smart Shelves are dynamic, rule-based collections that automatically populate with books matching criteria you define. Unlike regular shelves (where you add books manually), a smart shelf updates itself whenever books in your library change.

## Creating a Smart Shelf

1. In the left sidebar, expand the **Smart Shelves** section.
2. Click **New Smart Shelf** at the bottom of the section.
3. In the modal that appears:
   - Enter a **name** for the shelf.
   - Choose whether books must match **All rules (AND)** or **Any rule (OR)**.
   - Add one or more **rules** using the rule builder.
4. Click **Create shelf**.

The shelf will immediately appear in the sidebar and show all matching books.

## Rule Builder

Each rule has three parts:

| Part         | Description                         |
| ------------ | ----------------------------------- |
| **Field**    | The book attribute to match against |
| **Operator** | How to compare the value            |
| **Value**    | The text or number to compare with  |

### Available Fields

| Field          | Description                                              |
| -------------- | -------------------------------------------------------- |
| Title          | Book title                                               |
| Author         | Author name                                              |
| Genre          | Genre tag                                                |
| Tag            | Any tag applied to the book                              |
| Language       | Language code (e.g. `en`)                                |
| Publisher      | Publisher name                                           |
| Series Name    | Name of the series                                       |
| Format         | File format: `EPUB`, `MOBI`, `AZW`, `AZW3`, `CBZ`, `PDF` |
| Page Count     | Number of pages                                          |
| Published Year | Year of publication (e.g. `1990`)                        |
| ISBN-13        | ISBN-13 identifier                                       |

### Available Operators

| Operator       | Description                                      |
| -------------- | ------------------------------------------------ |
| `equals`       | Exact match (case-insensitive)                   |
| `not equals`   | Does not match                                   |
| `contains`     | Value appears anywhere in the field              |
| `starts with`  | Field begins with the value                      |
| `greater than` | Field is greater than the value (numeric fields) |
| `less than`    | Field is less than the value (numeric fields)    |

### AND vs OR Logic

- **All rules (AND)** — A book must satisfy every rule to appear in the shelf. Use this for narrow, precise collections (e.g. fantasy books over 500 pages).
- **Any rule (OR)** — A book only needs to satisfy one rule to appear. Use this for broad collections (e.g. books by either of two authors).

## Editing a Smart Shelf

Hover over the smart shelf in the sidebar and click the **settings icon** (🎚️) that appears. The settings modal lets you:

- **Rename** the shelf.
- **Change the AND/OR logic**.
- **Add, modify, or remove rules**.
- **Delete** the shelf (requires confirmation).

## Viewing a Smart Shelf

Click any smart shelf in the sidebar to open its page. The page shows:

- The active rules as badges (with AND/OR connectors between them).
- The total number of matching books (capped at 500 displayed at once).
- A grid of all matching book covers.

Click any book cover to open the book detail modal.

## Examples

**Long fantasy books**

- Title contains `fantasy` — OR —
- Genre equals `Fantasy`
- Page Count greater than `400`
- Logic: **All rules (AND)**

**Books by a specific author**

- Author contains `Tolkien`
- Logic: **All rules (AND)**

**Unread EPUBs or MOBIs**

- Format equals `EPUB`
- Format equals `MOBI`
- Logic: **Any rule (OR)**
