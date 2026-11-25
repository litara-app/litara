# Edit Metadata tab specification (draft)

Date: 2026-11-21. Status: proposal input for T004/T005. It accepts no architecture. Governing records: ADR-0014, 0047, 0048, 0049, 0060; proposed ADR-0095.

Reference: BookOrbit Edit Metadata tab screenshot supplied by the user, 2026-11-21 (observed UI, not code). Archived Litara `EditMetadataTab.tsx` has per-field lock buttons plus Lock All/Unlock All; it is historical reference only.

## Layout

Four columns beside a header toolbar, as in the reference:

- **Toolbar:** completeness score and missing-field chip, Load from file, Write to file, Search, Auto-fill, lock all/unlock all, discard, Save.
- **Cover column:** preview, File/URL source switch, Choose image, Find cover online, Regenerate cover, and a Source card (library, primary format, write-back capability, last written).
- **Identity:** title, subtitle, authors, series (name, position, total), publisher, genres, tags.
- **Catalog:** language, published date, year, page count, ISBN-13/10, rating, provider IDs, community ratings (read-only provider data).
- **Description:** rich text with preview.

The tab is edition-centered with a title section in the same form (accepted in ADR-0095, 2026-11-21). Audio recordings add narrators, duration (read-only) and Audnexus identifiers in their own section. The completeness score and the Arbitrary-URL cover source are not in the first release; the score shown in the toolbar above is deferred. Covers come from file upload or a provider candidate.

## Field behavior

Every editable field shows a state badge and a lock toggle.

| State | Meaning | Provider auto-fill | Review apply |
| --- | --- | --- | --- |
| inherited | value from sidecar, embedded or provider | may be replaced by higher source | allowed |
| edited | user value | blocked | preselected only if user ticks it |
| cleared | deliberate empty | blocked, not a gap | not preselected |
| locked | frozen | blocked | needs unlock or override |

Per-field hover shows provenance: source, provider and candidate ID, fetched time. Read-only: file-derived values (duration, format), provider community ratings, and IDs shown as provider links where the user may edit the ID itself.

## Provider flow

1. **Search** opens a drawer. Providers shown are those enabled for the library, in the library's configured order (Open Library, Google Books for ebooks; Audnexus for audio). Disabled, missing-key, rate-limited and unavailable providers show as such rather than hiding.
2. Query defaults come from title/authors/ISBN/provider IDs and are editable. The user is told what is sent to the provider.
3. Results list cover, title, authors, year, identifiers, provider and a match explanation. No result is chosen automatically.
4. Selecting a candidate opens the **diff review**: one row per field, current versus candidate, checkbox per row. Empty-current-and-unlocked rows are preselected; locked, edited, cleared rows are not. Apply updates the form, and Save commits it.
5. **Auto-fill** skips the drawer only when an identifier match is unique and consistent (ADR-0060). It fills empty unlocked fields and reports what it filled, or opens review otherwise.

Provider calls run server-side as bounded jobs; the browser never calls providers and book files are never uploaded (ADR-0049).

## Save, conflict and write-back

- Save sends changed fields plus the loaded revision. A stale revision returns a conflict naming changed fields; the tab offers reload or per-field resolution.
- Unsaved changes prompt on navigation.
- Write to file opens the ADR-0048 review (fields, target file, format capability, backup setting, recovery) and is disabled with a reason for formats without a fidelity-tested writer. Save never writes files.

## Accessibility and states

Labels on all inputs and lock toggles with state text, keyboard-operable tag inputs and diff review, visible loading, error, incomplete and permission-denied states, and library grants enforced for every action (ADR-0013/0031/0056).

## Out of scope

Goodreads, Hardcover, Amazon, iTunes and Audible providers (not accepted), automatic write-back, transcoding, and the web implementation itself, which needs T005 and a stable T004 contract.

## Next steps

1. User accepts or amends ADR-0095 and answers its open questions.
2. Fold the field/state/provenance shapes into the T004 contract and brief.
3. T005 builds the tab against that contract.
