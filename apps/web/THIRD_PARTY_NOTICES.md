# Third-party notices (web application)

Runtime (production) npm dependencies bundled into the built web application (`apps/web/dist`), from the pinned `package-lock.json`. The list was produced with `npm ls --omit=dev --all` and each package's own `package.json`/license file (`research/t007/evidence/m5-package/web-prod-licenses.json`). The bundler removes per-file headers, so this file is the notice for them. Each package's full license text is in its published package at the version shown. Development-only packages (TypeScript, Vite, Vitest, Playwright and so on) are not shipped.

| Package | Version | License | Copyright line |
| --- | --- | --- | --- |
| `@emnapi/wasi-threads` | 2.2.0 | MIT | Copyright (c) 2021-present Toyobayashi |
| `@floating-ui/core` | 1.8.0 | MIT | Copyright (c) 2021-present Floating UI contributors |
| `@floating-ui/dom` | 1.8.0 | MIT | Copyright (c) 2021-present Floating UI contributors |
| `@floating-ui/react` | 0.27.20 | MIT | Copyright (c) 2021-present Floating UI contributors |
| `@floating-ui/react-dom` | 2.1.9 | MIT | Copyright (c) 2021-present Floating UI contributors |
| `@floating-ui/utils` | 0.2.12 | MIT | Copyright (c) 2021-present Floating UI contributors |
| `@fontsource-variable/fraunces` | 5.3.0 | OFL-1.1 | Copyright 2020 The Fraunces Project Authors (font files are bundled; license text in `public/licenses/fonts-OFL.txt`) |
| `@fontsource-variable/source-sans-3` | 5.3.1 | OFL-1.1 | Source Sans 3 font files, Adobe and Google Inc. (license text in `public/licenses/fonts-OFL.txt`) |
| `@fontsource/atkinson-hyperlegible` | 5.3.0 | OFL-1.1 | Atkinson Hyperlegible font files, Copyright 2020 Braille Institute of America, Inc. (font files are bundled and fetched when chosen, ADR-0091; license text in `public/licenses/fonts-OFL.txt`) |
| `@fontsource/literata` | 5.3.0 | OFL-1.1 | Literata font files, Copyright 2017 The Literata Project Authors (font files are bundled and fetched when chosen, ADR-0091; license text in `public/licenses/fonts-OFL.txt`) |
| `@fontsource/opendyslexic` | 5.3.0 | OFL-1.1 | OpenDyslexic font files, Copyright (c) 2019 Abbie Gonzalez, Reserved Font Name OpenDyslexic (font files are bundled and fetched when chosen, ADR-0091; license text in `public/licenses/fonts-OFL.txt`) |
| `@fontsource/im-fell-english` | 5.3.0 | OFL-1.1 | IM Fell English font files, Igino Marini and Google Inc. (license text in `public/licenses/fonts-OFL.txt`) |
| `@remix-run/route-pattern` | 0.22.1 | MIT | Copyright (c) 2025 Shopify Inc. |
| `@tanstack/query-core` | 5.107.1 | MIT | Copyright (c) 2021-present Tanner Linsley |
| `@tanstack/react-query` | 5.107.1 | MIT | Copyright (c) 2021-present Tanner Linsley |
| `@types/react` | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| `@types/react-dom` | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| `@ui-sdk/core` | 0.1.0-beta.10 | Apache-2.0 | Copyright 2026 Vercel, Inc. |
| `@ui-sdk/react` | 0.1.0-beta.10 | Apache-2.0 | Copyright 2026 Vercel, Inc. |
| `clsx` | 2.1.1 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| `cookie-es` | 3.1.1 | MIT | Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> |
| `csstype` | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| `detect-node-es` | 1.1.0 | MIT | Copyright (c) 2017 Ilya Kantor |
| `get-nonce` | 1.0.1 | MIT | Copyright (c) 2020 Anton Korzunov |
| `react` | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `react-dom` | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `react-number-format` | 5.4.5 | MIT | Copyright (c) 2020-present Sudhanshu Yadav |
| `react-remove-scroll` | 2.7.2 | MIT | Copyright (c) 2017 Anton Korzunov |
| `react-remove-scroll-bar` | 2.3.8 | MIT | no license file in the package; see its repository |
| `react-router` | 8.5.1 | MIT | Copyright (c) React Training LLC 2015-2019 |
| `react-style-singleton` | 2.2.3 | MIT | Copyright (c) 2017 Anton Korzunov |
| `scheduler` | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| `tabbable` | 6.5.1 | MIT | Copyright (c) 2015 David Clark |
| `tagged-tag` | 1.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |
| `tslib` | 2.9.1 | 0BSD | Copyright (c) Microsoft Corporation. |
| `type-fest` | 5.10.0 | (MIT OR CC0-1.0) | no license file in the package; see its repository |
| `use-callback-ref` | 1.3.3 | MIT | Copyright (c) 2017 Anton Korzunov |
| `use-sidecar` | 1.1.3 | MIT | Copyright (c) 2017 Anton Korzunov |

The UI SDK Apache 2.0 license ships with the web build at `licenses/ui-sdk.txt`. The setup imports the core stylesheet.

Vendored reader engines (foliate-js, zip.js, fflate, PDF.js) ship with their own license files under `public/reader/vendor/`; see `public/reader/vendor/PROVENANCE.md` for pins and checksums.
