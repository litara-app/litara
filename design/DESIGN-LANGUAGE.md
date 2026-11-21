# Litara design language

Status: in force for `apps/web` from ADR-0079. Starting visual: [a3-ledger-collapsible.html](mockups/a3-ledger-collapsible.html). Component estimate: [COMPONENTS.md](COMPONENTS.md).

The rules are numbered so reviews can cite them. Rules marked **[enforced]** are checked by `apps/web/src/ui/designLanguage.test.ts` and fail `npm test`. The rest are enforced by review.

## 1. Principles

1. **Dense, calm, scannable.** Litara holds thousands of titles with editions, recordings, progress, health and sync state. Prefer a table row over a card, and one line over two.
2. **Status is never color alone.** Every state has a text label or icon as well as a tone (a11y).
3. **Every screen has four states:** loading, empty, error and loaded. Use `Busy`, `EmptyState` and `ErrorBox`; never an unstyled message.
4. **Pending work and conflicts are visible.** Unsent changes, resume conflicts and incomplete recordings show in the top bar, the sidebar and the affected row.
5. **UI SDK only [enforced].** No other component library. Never hand-roll what UI SDK ships: do not write `role="dialog"`, `"menu"`, `"tablist"`, `"listbox"`, `"switch"`, `"separator"` and similar. [enforced]
6. **One way to do each thing.** Screens compose kit components from `src/ui/`. A screen that needs a new look adds it to the kit.

## 1a. Theme: the Reading Room

Litara looks like a library, not a dashboard. The theme is a skin over the structure in `src/ui/kit.css`; it lives in `src/ui/tokens.css` (palette, fonts, textures) and `src/ui/theme.css` (decoration). Change the look there, never in a screen.

- **Materials.** Cream paper pages on a desk (`--lt-surface` on `--lt-bg` with a paper grain), dark leather for the top bar, sidebar, drawers and reader bar, gold foil (`--lt-foil`) for hairlines and the wordmark, an oxblood ribbon (`--lt-ribbon`) for "you are here", and bookcloth blue (`--lt-pri`) for primary actions.
- **Type.** Fraunces (`--lt-font-display`) for titles, links to works and anything that names a book; Source Sans 3 (`--lt-font-sans`) for controls and body text so dense screens stay readable; IM Fell English (`--lt-font-accent`) for old-book accents only: field labels, table headers, captions, page numbers, the sidebar group headings. Do not use the accent face for paragraphs. All three are bundled from `@fontsource` packages (SIL OFL) because the CSP allows only same-origin fonts.
- **Book parts.** The current page in the sidebar is a ribbon bookmark. Tabs are index tabs. Cards are sheets with a visible stack beneath. The library inspector is a catalog card with a ribbon-red top rule and ruled lines. Covers have a spine shadow and page edges. Chapter lists use dotted leaders to times. Page headers end in a fleuron rule. Empty states show an open book and loading shows a page turning. Alerts are paper slips with a thick colored edge.
- **Sign-in.** A regular-sized leather book with a gold frame and the logo, closed by a small brass clasp that barely peeks over its fore-edge. On a correct sign-in the clasp dissolves, the cover swings back on its spine, and the blank paper page inside grows to fill the screen and becomes the app background as the app fades in (under a second). A wrong password shakes the clasp. Under `prefers-reduced-motion` there is no animation. The book lies on one of three picture backdrops the owner generated with ChatGPT (`marble`, `library`, `shelves`, in `src/assets/backgrounds/`). People pick one, or "Surprise me", under Settings, Appearance; preview any with `/login?scene=marble|library|shelves`.
- **Two themes.** Reading Room is the default. Clean is the plain, compact look (system fonts, no decoration, plain sign-in card). People choose under Settings, Appearance. The choice is stored in the browser only (key `litara.theme`) until a server-side preference exists. `theme.css` is scoped to the Reading Room with CSS nesting; Clean overrides the same tokens in `tokens.css`. A screen must look right in both, so style through tokens and kit classes only.
- **Field errors.** A validation or server error sits on the label line, right-aligned, in space the field already uses, so it never moves a row. Keep visible messages short ("Required", "Too short") and put exact requirements in the label or in screen-reader-only text. A long label is truncated when its field shows an error.
- **Account and mode.** The signed-in person is an avatar with their initials at the very bottom of the sidebar, with a small arrow showing it opens a menu (Settings, Sign out); collapsed, it is just the avatar. The far right of the top bar holds a light/dark toggle: a reading lamp in the Reading Room, a sun and moon in Clean. It overrides the system setting and is remembered in this browser (`litara.mode`).
- **Clean sign-in.** The logo, the name and the tagline sit above the sign-in card on a very quiet backdrop: soft glow, dot grid, faint bookshelves or faint marbling (Settings, Appearance, when Clean is active; preview with `/login?bg=`).
- **Choosing a look.** Choices that are pictures use `ImagePicker`: a row of cards, each with its name above a preview, where the whole card selects it and a frame glides to the chosen one (a segmented control underneath, so arrow keys work). Under Settings, Appearance, "Preview sign-in" opens a full-screen copy of the sign-in screen in the current theme and background; its Sign in button plays the open animation without signing anyone in, and Esc or "Close preview" leaves it.
- **Limits.** Decoration never carries meaning and never replaces a label. Every text and control pair still meets section 8 in light and dark. Motion (page turn, twinkling stars) stops under `prefers-reduced-motion`. Textures are inline SVG so nothing extra is fetched. New decorative colors need a token first.

## 2. Tokens

All values live in `src/ui/tokens.css`. Screens and components reference tokens, never raw values.

| Group | Tokens |
| --- | --- |
| Surface | `--lt-bg` page, `--lt-surface` panels, `--lt-surface-2` raised rows, `--lt-line` dividers |
| Text | `--lt-ink`, `--lt-dim` (secondary, 4.5:1 minimum on every surface) |
| Brand | `--lt-pri`, `--lt-pri-soft`, `--lt-pri-ink` (logo blue `#228be6` is for the mark only) |
| Tone | `--lt-ok`, `--lt-warn`, `--lt-bad`, `--lt-audio`, each with `-soft` and `-ink` |
| Space | `--lt-s1` 4px, `s2` 8, `s3` 12, `s4` 16, `s5` 24, `s6` 32 |
| Radius | `--lt-r` 6px controls, `--lt-r-lg` 10px surfaces |
| Type | `--lt-text-xs` 11.5px, `sm` 12.5, `md` 13.5 (body), `lg` 16, `xl` 20, `2xl` 28 |
| Layout | `--lt-topbar` 44px, `--lt-side` 232px, `--lt-side-collapsed` 56px, `--lt-inspector` 340px |

Rules:

- **No hex, rgb or hsl colors in `.tsx` files [enforced].** Color comes from tokens in CSS.
- **No inline `style` attributes except a CSS custom property** (for example `style={{ "--h": 220 }}` on a cover) **[enforced]**.
- Spacing uses the scale. Gaps in `Stack` and `Row` accept `xs|sm|md|lg|xl` only.
- Light and dark themes both ship. Tokens use `light-dark()`. Check both.

## 3. Typography

- Body: Source Sans 3 at 14.5px, line height 1.45. Headings and titles of works use Fraunces; accents use IM Fell English (see 1a).
- Use `Heading` levels 1 to 4 for hierarchy, in order. One level 1 per page, in `PageHeader`.
- Secondary text is `Text tone="dim"`. Never lighten text below `--lt-dim`.
- Numbers in tables are right-aligned and use tabular figures. Identifiers, paths and hashes use `Code`.
- Truncate with `lineClamp`; never let one long title break a row.

## 4. Layout

- **Shell:** top bar (44px) over a sidebar and content. The inspector pane is optional and appears only on screens with a selectable list.
- **Sidebar:** expanded 232px with icons, labels, counts and collapsible groups; collapsed 56px with icons only, tooltips on single items and flyouts for groups. `[` toggles it. The choice persists. Keep the same item order in both states.
- **Content width:** lists and tables fill the width. Forms and prose cap at 72ch (`Stack` inside `FormColumn`).
- **Pages** start with `PageHeader` (title, short description, actions on the right), then optional `Toolbar`, then content.
- **Responsive:** below 1250px the inspector hides; below 760px the sidebar becomes an overlay drawer and tables scroll in a `ScrollRegion`.

## 5. Components

- **Buttons.** One primary button per view or dialog. Variants: `primary`, `default`, `subtle`, `danger`. Destructive actions use `danger` and a `ConfirmDialog` that names what is lost and whether it can be undone. Icon-only buttons have an accessible name and a `Tooltip`.
- **Icons on actions.** A button or link that performs an action carries an icon beside its label, never the bare word: Back (arrow), Read (open book), Listen (headphones), Download, Add to shelf, Mark finished (check), Edit (pencil), Delete (bin), Save and so on. The icon comes first, the label stays visible, and the icon is decorative (`aria-hidden`) because the label names the action. Icon-only controls (the 3-dot menu, the light/dark toggle) need an `aria-label` and a tooltip. Use one icon per action everywhere so it means the same thing on every screen, taken from `src/ui/icons.tsx`. Tabs, menu rows that are plain navigation, and table headers do not need icons.
- **Forms.** Every control sits in a field with a visible label. Help goes in the description, errors in `FieldError`. Server errors set `invalid` on the field. Submit on Enter. Buttons sit bottom-left, primary first. Disable Save until the form is dirty and valid.
- **Tables.** Dense rows, sticky header, a primary column first, status last. Sortable columns say so. Row actions go in a trailing `Menu` or inline compact buttons. Wide tables sit in `ScrollRegion` (keyboard scrollable).
- **Tabs** split a page into peers of one object (Title: Editions, Chapters, Notes). Use route-linked tabs when the tab should be linkable.
- **Dialogs** hold one focused task, with a title and an explicit way out. Never nest dialogs.
- **Menus** hold three or more secondary actions. Two or fewer stay as buttons.
- **Badges** are short (one or two words), lower case or title case, from the tone vocabulary in section 6.
- **Alerts** go above the content they concern and say what happened, why it matters and what to do.

## 6. Status vocabulary

| Meaning | Tone | Label examples |
| --- | --- | --- |
| Ready, finished, healthy, supported | `success` | Ready, Finished, Healthy |
| Needs a look, incomplete, pending, offline | `warning` | Incomplete, Pending, Needs review |
| Failed, destructive, blocked | `danger` | Failed, Revoked |
| Information, in progress | `info` | Reading, Scanning |
| Audio content | `audio` | Audiobook, Listening |
| Absent, disabled, unsupported | `neutral` | Disabled, Unsupported |

The same state uses the same tone and wording on every screen. Add new states to `StatusPill` or `Badge` mappings, not to a screen.

## 7. Content

- Sentence case everywhere. Buttons start with a verb: "Create credential", "Save settings".
- Name the object: "Revoke Kobo", not "Revoke".
- Errors say what failed and what to try, without internal codes. Show the code in parentheses only when the API supplies one.
- Empty states explain what belongs here and offer the next action.
- Use "title", "edition", "recording", "library", "shelf" as the product defines them (ADR-0006). Do not invent synonyms.

## 8. Accessibility

- WCAG 2.2 AA. Text 4.5:1, control edges, focus rings and state fills 3:1, in light and dark.
- Everything works from the keyboard. Focus is always visible (`--lt-ring`). Click targets are at least 24px.
- Every control has an accessible name from its label part or `aria-label`. Landmarks: `header`, `nav`, `main`, plus named `region`s for scrollable areas.
- Respect `prefers-reduced-motion`; motion is 120 to 180ms for state changes and none for essential information.
- Verify color in a real browser. jsdom cannot.

## 9. Agent readiness

UI SDK exposes controls to agents. Keep that property: use the SDK components, label them, and add the agent test from the `ui-sdk` skill to each new screen.

## 10. Adding to the kit

1. Check `COMPONENTS.md`. If the SDK ships the component, wrap it in `src/ui/` with a Litara-specific API.
2. If it does not, build it from `@ui-sdk/core` behaviors per the skill's component-creation path.
3. Style with tokens and `data-slot` or state attributes in `src/ui/kit.css`.
4. Add a test that covers its states and its accessible name, and document it here if it changes a rule.

## 1b. Title page and covers (Reading Room)

- **Folio.** The title page is a framed folio: a top bar with Back and the tabs (Details, Edit metadata for administrators, Files, Reading log, Highlights; linkable as `?tab=`), a cover column (cover, Read, then icon-only Listen, Download, Add to shelf, Send), and panels. The skin is emerald bookcloth with brass: dark green ground, brass hairlines, two brass corner brackets on each panel, IM Fell for panel titles and quotes. It redeclares the `--lt-*` and `--ui-*` tokens on `.lt-folio`, so every kit component inside follows it; Clean keeps the plain tokens.
- **Covers.** A cover is only the cover. Format tags sit on its top right (`EPUB`, `EPUB +` for several, ebook above audiobook). Hover or focus shows a translucent plate with title and author and reveals a three-dot menu bottom right (Read, Listen, Download, Add to shelf); touch devices always show the menu. Clicking the cover opens the title.
- **Icon-only actions** use `IconAction` (tooltip and accessible name). Everything else with a label has an icon too; `designLanguage.test.ts` fails when a labelled `<Button>` has none.
