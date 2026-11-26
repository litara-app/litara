# Litara UI mockups

Static HTML explorations. Serve this folder (`python -m http.server`) and open a file; the scripts do not run from a plain `file://` preview.

| File | What it is |
| --- | --- |
| `a3-ledger-collapsible.html` | **Chosen starting point** (2026-11-19, ADR-0079): A's top bar, table and inspector with a sidebar that collapses to an icon rail with flyouts. |
| `a-ledger.html`, `b-shelf.html`, `c-console.html`, `d-hub.html` | The four first-round designs. |
| `a2-ledger-sidebars.html` | Four sidebar options for A. |

`data.js` and `covers.css` hold shared sample data. The implementation is in `apps/web/src/ui/`; the rules are in [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md).

- `reading-room-authors-series.html`: the Authors and Series pages the owner chose from two options each (2026-11-25): cabinet-card authors and fanned-cover series, with the same detail bar and left column on both pages, styled like the book page, and author editing with online lookup and field locks (ADR-0101, ADR-0102), plus series lookup and greyed-out missing books (ADR-0103). Provider results are invented. The pages, editing, online lookup and greyed-out missing books are built. The author portraits are invented and drawn in code.
- `reading-room-covers-and-title.html`: four cover hover treatments and four title-page layouts for the Reading Room theme (view with `python -m http.server` from the repo root so the fonts load).
- `reading-room-title-dense.html`: four information-dense title pages (leather banner on paper, then gilt folio, gilt dossier and gilt marginalia on dark leather).
- `reading-room-gilt-folio-variants.html`: the chosen gilt folio title page in three skins (midnight gilt, oxblood and vellum, emerald and brass).
