# Vendored reader engines (unmodified)

| Component | Pin | License | Source |
|---|---|---|---|
| foliate-js | commit 78914aef4466eb960965702401634c2cb348e9b1 (2026-05-01) | MIT (`foliate-js/LICENSE`) | https://github.com/johnfactotum/foliate-js |
| PDF.js (`pdfjs-dist`) | 6.5.438, `build/pdf.mjs` + `build/pdf.worker.mjs` | Apache-2.0 (`pdfjs/LICENSE`) | npm `pdfjs-dist` |

foliate-js files copied byte-for-byte: view, epub, epubcfi, comic-book, fb2, fixed-layout, mobi, overlayer, paginator, progress, search, text-walker, uri-template, footnotes, and its `vendor/zip.js` (zip.js, BSD-3-Clause) and `vendor/fflate.js` (MIT). foliate's `pdf.js` wrapper, bundled pdfjs copy, tts, reader UI and tests are deliberately omitted (direct PDF.js is used for PDF, ADR-0027).
SHA-256 of every vendored file: `CHECKSUMS.sha256`. Litara-owned code (`../bridge.js`, `../frame.html`) is outside this directory.
Third-party notices for the two bundled helpers under `foliate-js/vendor/`: `LICENSE.zip.js.txt` (zip.js, BSD-3-Clause, Gildas Lormeau) and `LICENSE.fflate.txt` (fflate, MIT, Arjun Barrett). The texts were taken from the published npm packages `@zip.js/zip.js` 2.25.0 and `fflate` 0.8.3 because foliate-js ships these as minified bundles without a license header or version; the exact upstream versions inside the bundles were not determined, so the copyright years may differ from the bundled copies. Foliate-js's own license is `foliate-js/LICENSE`; PDF.js's is `pdfjs/LICENSE` (Apache-2.0).
Not vendored yet: PDF.js cmaps/standard fonts/wasm (affects some CJK, non-embedded fonts and JPX/CCITT images).
