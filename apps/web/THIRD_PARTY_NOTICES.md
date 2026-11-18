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
| `@mantine/core` | 9.8.0 | MIT | Copyright (c) 2021 Vitaly Rtishchev |
| `@mantine/hooks` | 9.8.0 | MIT | Copyright (c) 2021 Vitaly Rtishchev |
| `@remix-run/route-pattern` | 0.22.1 | MIT | Copyright (c) 2025 Shopify Inc. |
| `@tanstack/query-core` | 5.107.1 | MIT | Copyright (c) 2021-present Tanner Linsley |
| `@tanstack/react-query` | 5.107.1 | MIT | Copyright (c) 2021-present Tanner Linsley |
| `@types/react` | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| `@types/react-dom` | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
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

Vendored reader engines (foliate-js, zip.js, fflate, PDF.js) ship with their own license files under `public/reader/vendor/`; see `public/reader/vendor/PROVENANCE.md` for pins and checksums.
