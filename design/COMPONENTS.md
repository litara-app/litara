# Litara web component estimate

Governing decision: [ADR-0079](../ADR/0079-ui-sdk-only-web-interface.md). Visual starting point: [a3-ledger-collapsible.html](mockups/a3-ledger-collapsible.html). Standards: [DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md).

## How this was estimated

1. Counted every Mantine component the current app uses (about 900 usages in 32 files; Text 129, Button 118, Group 117, Table 106, Stack 70, Badge 52, Alert 49, Title 39, TextInput 27, Card 27, Tabs 25, Select 19, Code 13).
2. Listed the screens the rebuild needs: the 20 existing routes plus the planned ones that the A3 mockup shows (home, series, authors, annotations, review queue).
3. Mapped each need to a UI SDK component first (per the `ui-sdk` skill table). Anything the SDK does not ship is a first-party component built from design tokens, or from `@ui-sdk/core` behaviors when it needs interaction.

## Inventory

`SDK` = thin wrapper over a UI SDK component. `Own` = first-party markup and CSS. `Core` = needs `@ui-sdk/core` behavior.

### Layout and typography (Own)

| Component | Replaces | Notes |
| --- | --- | --- |
| `Stack`, `Row` | Stack, Group | Gap from the spacing scale only; `Row` has `justify`, `align`, `wrap`, `grow`. |
| `Grid` | SimpleGrid | Auto-fill columns with a minimum width. |
| `Card` | Card, Paper | One surface style; optional `tone` edge for status. |
| `PageHeader`, `Section` | Title + Group patterns | Title, subtitle, actions slot; sections have a heading and optional actions. |
| `Toolbar` | Filter rows | Filter chips, view toggle and bulk actions above tables. |
| `Text`, `Heading`, `Code`, `Kbd` | Text, Title, Code | Sizes and tones from the type scale. |
| `TextLink` | Anchor | Router link styled as text. |
| `Divider` | Divider | Wraps SDK `Separator`. |

### Feedback and status (Own, one SDK wrapper)

| Component | Notes |
| --- | --- |
| `Badge` | Tones: neutral, info, success, warning, danger, audio. |
| `StatusPill` | Reading, listening, finished, unread; derives tone and label. |
| `FormatTag` | EPUB, PDF, CBZ, M4B in monospace. |
| `CapabilityBadge` | Supported, incomplete, unsupported, with issue details. |
| `Alert` | Inline banner; `role=alert` for errors, `status` otherwise. |
| `ErrorBox`, `Busy`, `EmptyState` | Shared loading, error and empty states. |
| `ProgressBar` | SDK `Progress`; compact table variant. |
| `Cover` | Generated placeholder or real image, fixed 2:3 ratio. |
| `Toaster` | SDK `Toast`; for confirmations that need no decision. |

### Data display

| Component | Kind | Notes |
| --- | --- | --- |
| `Table`, `THead`, `TBody`, `TR`, `TH`, `TD` | Own | Dense by default, sticky header, `ScrollRegion` wrapper. |
| `DataTable` | Own + Core | Rows, sortable headers, selection, keyboard row navigation for the library table. |
| `Pager` | SDK | Pagination wired to router search params. |
| `KeyValue` | Own | Definition list for the inspector and metadata. |
| `Timeline` | SDK | Scan and sync history. |

### Controls (SDK)

| Component | SDK part | Notes |
| --- | --- | --- |
| `Button`, `LinkButton`, `IconButton` | Button | Variants: primary, default, subtle, danger. Pending state comes from the SDK. |
| `TextField`, `PasswordField`, `NumberField`, `TextAreaField` | Field + Input, PasswordInput, NumberInput, Textarea | Label, description and error always present. |
| `SelectField` | Field + Select | Takes `items`; clearable option. |
| `CheckboxField`, `SwitchField` | Checkbox, Switch | Label to the right. |
| `SegmentedField` | SegmentedControl | View and scope toggles. |
| `SearchField` | Input + InputClear | Top bar and table filter. |
| `Menu` | Menu | Row actions and "Add to shelf". |
| `Modal`, `ConfirmDialog` | Dialog, AlertDialog | Confirmation for destructive actions. |
| `Tooltip` | Tooltip | Icon-only controls only. |
| `Tabs` | Tabs | Panels and route-linked variants. |

### Application shell (Own + SDK + Core)

| Component | Notes |
| --- | --- |
| `AppShell` | Top bar, sidebar, content, optional inspector. |
| `TopBar` | Logo, global search with `Ctrl K`, sync status, account menu. |
| `Sidebar` | Expanded 232px or collapsed 56px; section collapse; flyouts when collapsed; state remembered. |
| `NavItem`, `NavGroup`, `NavFlyout` | Icon, label, count, badge; flyout uses SDK Popover. |
| `Inspector` | Right pane for the selected row. |
| `CommandPalette` | SDK Command; later milestone. |

### Domain compositions

`TitleRow`, `TitleCard`, `EditionCard`, `RecordingCard`, `ChapterList`, `AnnotationList`, `DeviceList`, `ConflictBanner`, `PendingChangeRow`, `LibraryHealthCard`, `ShelfList`, `MetadataTable` with source column, `PlayerBar` (Core, docked player), `ReaderToolbar`.

## Estimate

| Group | Count | Build order |
| --- | --- | --- |
| Tokens, CSS, standards test | 3 files | 1 |
| Layout, typography, feedback | 22 | 1 |
| Controls and overlays | 16 | 2 |
| Tables and pager | 8 | 2 |
| Shell | 8 | 3 |
| Domain compositions | 14 | 4 |
| **Total** | **about 70** | |

About 40 are one- to ten-line wrappers. The costly parts are `Sidebar` with flyouts, `DataTable`, `PlayerBar` and the reader toolbar.

## Screens and the components they need

| Screen | Needs |
| --- | --- |
| Sign in | `Card`, `TextField`, `PasswordField`, `Button`, `ErrorBox` |
| Library | `AppShell`, `Toolbar`, `DataTable` or `Grid` of `TitleCard`, `Inspector`, `Pager`, `Menu` |
| Title, Edition | `PageHeader`, `Tabs`, `EditionCard`, `RecordingCard`, `ConflictBanner`, `MetadataTable`, `AnnotationList` |
| Shelves, Shelf | `Card`, `Table`, `Modal`, `SegmentedField`, filter editor |
| Pending | `Table`, `PendingChangeRow`, `ConfirmDialog` |
| Settings | `Tabs`, forms, `Table`, `Modal`, `Switch` |
| Administration | `Table`, forms, `LibraryHealthCard`, `Timeline`, repair plan editor |
| Reader, Listen | `ReaderToolbar`, `PlayerBar`, `ChapterList`, `Menu`, `Progress` |

## Planned screens without an API

Home, Series, Authors, Annotations and Review queue appear in the mockup. The rebuild's API contracts do not yet list them as endpoints the web client uses, so the sidebar shows only routes that exist. Add the links when the endpoints land.

## Kbd and Spotlight
- `Kbd` (`ui/text.tsx`): UI SDK ships no Kbd component. Ours follows the SDK docs' `<kbd aria-hidden data-slot="kbd">` markup; `shortcut="mod+k"` renders platform keys through the SDK's `useShortcutHint`.
- `Spotlight` (`ui/Spotlight.tsx`): top-bar search button plus a SDK `Dialog` + `Command` palette, opened with Ctrl+K / Cmd+K (`DialogTrigger shortcut`). Sections: Books and audiobooks (server `/titles?q=`), Libraries, Shelves, Users (admins), Pages and settings, Actions (mode, theme, sign out). Add a page to the `pages` list in `Spotlight.tsx` when adding a route.

## Title page
`pages/TitlePage.tsx` is a hero (cover, formats, Read/Listen) over `Tabs`: Details, Files, Highlights, Reading log and, for administrators, Edit metadata. Each tab is a file in `pages/title/`. New shared pieces: `Timeline` (`ui/timeline.tsx`), `Quote` (`ui/text.tsx`), `duration()` and `when()` (`ui/format.ts`). Metadata edits use the existing admin endpoints, so they are protected across rescans and never change the book file.

## Folio and covers
`Panel`, `Ledger` (`ui/layout.tsx`), `TabFrame`/`TabBar`/`TabPane` (`ui/nav.tsx`, one tab set whose bar and panels sit apart), `BookCover`, `CoverTile`, `formatLabel` (`ui/bookcover.tsx`), `IconAction` and the `icon` prop on `Button` (`ui/controls.tsx`), icon-only `MenuButton` (`ui/overlays.tsx`). `useShelfActions` and `useTitleActions` (`pages/`) share shelf adding and read/listen/download across the library grid and title page.

## Rating and dates
`StarRating` (`ui/rating.tsx`, SDK `Rating`, half-star steps, counts half stars like the server) and `DateField` (`ui/datefield.tsx`, SDK `DateInput`; `isoToDate`/`dateToIso` convert to and from the stored times). `pages/title/usePersonal.ts` reads and writes the caller's rating, review and date overrides with the right revision.
