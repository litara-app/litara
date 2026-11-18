# Third-party notices (server)

Go modules added for CBR and CB7 extraction under ADR-0072. Each module is used unmodified; the full license text of each is in `third_party/licenses/`. Versions are the ones pinned in `go.mod`/`go.sum`. See `research/t005/cbr-cb7-audit.md` for the audit.

| Module | Version | License | Text |
| --- | --- | --- | --- |
| `github.com/andybalholm/brotli` | v1.3.0 | MIT | [github.com_andybalholm_brotli.LICENSE.txt](third_party/licenses/github.com_andybalholm_brotli.LICENSE.txt) |
| `github.com/bodgit/plumbing` | v1.3.0 | BSD-3-Clause | [github.com_bodgit_plumbing.LICENSE.txt](third_party/licenses/github.com_bodgit_plumbing.LICENSE.txt) |
| `github.com/bodgit/sevenzip` | v1.6.5 | BSD-3-Clause | [github.com_bodgit_sevenzip.LICENSE.txt](third_party/licenses/github.com_bodgit_sevenzip.LICENSE.txt) |
| `github.com/bodgit/windows` | v1.0.1 | BSD-3-Clause | [github.com_bodgit_windows.LICENSE.txt](third_party/licenses/github.com_bodgit_windows.LICENSE.txt) |
| `github.com/hashicorp/golang-lru/v2` | v2.0.7 | MPL-2.0 | [github.com_hashicorp_golang-lru_v2.LICENSE.txt](third_party/licenses/github.com_hashicorp_golang-lru_v2.LICENSE.txt) |
| `github.com/klauspost/compress` | v1.20.4 | Apache-2.0 (the file also carries BSD-3-Clause parts) | [github.com_klauspost_compress.LICENSE.txt](third_party/licenses/github.com_klauspost_compress.LICENSE.txt) |
| `github.com/nwaples/rardecode/v2` | v2.4.6 | BSD-2-Clause | [github.com_nwaples_rardecode_v2.LICENSE.txt](third_party/licenses/github.com_nwaples_rardecode_v2.LICENSE.txt) |
| `github.com/pierrec/lz4/v4` | v4.1.33 | BSD-3-Clause | [github.com_pierrec_lz4_v4.LICENSE.txt](third_party/licenses/github.com_pierrec_lz4_v4.LICENSE.txt) |
| `github.com/spf13/afero` | v1.15.0 | Apache-2.0 | [github.com_spf13_afero.LICENSE.txt](third_party/licenses/github.com_spf13_afero.LICENSE.txt) |
| `github.com/stangelandcl/ppmd` | v0.1.1 | MIT | [github.com_stangelandcl_ppmd.LICENSE.txt](third_party/licenses/github.com_stangelandcl_ppmd.LICENSE.txt) |
| `github.com/ulikunitz/xz` | v0.5.15 | BSD-3-Clause | [github.com_ulikunitz_xz.LICENSE.txt](third_party/licenses/github.com_ulikunitz_xz.LICENSE.txt) |
| `go4.org` | v0.0.0-20260112195520-a5071408f32f | Apache-2.0 | [go4.org.LICENSE.txt](third_party/licenses/go4.org.LICENSE.txt) |

`github.com/hashicorp/golang-lru/v2` is MPL-2.0 (file-level copyleft). It is linked unmodified, so the obligations are to keep its license notice and to make its source available: the unmodified source is the published module at the version above (https://github.com/hashicorp/golang-lru). Any modification to those files would have to be published under MPL-2.0.

## Other modules compiled into the server and ctl binaries (T007 audit)

The modules below are linked unmodified (HTTP/API framework, PostgreSQL driver and job queue, migrations, JSON helpers and the Go extended libraries). The table was produced from `go list -deps ./cmd/server ./cmd/ctl` and each license file was read from the pinned module version (`research/t007/evidence/m5-package/go-modules-licenses.json`); the license kind is recognized from the license text, so confirm unusual cases before a release.

| Module | Version | License | Text |
| --- | --- | --- | --- |
| `github.com/danielgtaylor/huma/v2` | v2.40.0 | MIT | [github.com_danielgtaylor_huma_v2.LICENSE.txt](third_party/licenses/github.com_danielgtaylor_huma_v2.LICENSE.txt) |
| `github.com/google/uuid` | v1.6.0 | BSD-3-Clause | [github.com_google_uuid.LICENSE.txt](third_party/licenses/github.com_google_uuid.LICENSE.txt) |
| `github.com/jackc/pgpassfile` | v1.0.0 | MIT | [github.com_jackc_pgpassfile.LICENSE.txt](third_party/licenses/github.com_jackc_pgpassfile.LICENSE.txt) |
| `github.com/jackc/pgservicefile` | v0.0.0-20240606120523-5a60cdf6a761 | MIT | [github.com_jackc_pgservicefile.LICENSE.txt](third_party/licenses/github.com_jackc_pgservicefile.LICENSE.txt) |
| `github.com/jackc/pgx/v5` | v5.13.0 | MIT | [github.com_jackc_pgx_v5.LICENSE.txt](third_party/licenses/github.com_jackc_pgx_v5.LICENSE.txt) |
| `github.com/jackc/puddle/v2` | v2.2.3 | MIT | [github.com_jackc_puddle_v2.LICENSE.txt](third_party/licenses/github.com_jackc_puddle_v2.LICENSE.txt) |
| `github.com/mfridman/interpolate` | v0.2.0 | MIT | [github.com_mfridman_interpolate.LICENSE.txt](third_party/licenses/github.com_mfridman_interpolate.LICENSE.txt) |
| `github.com/pressly/goose/v3` | v3.30.1 | MIT | [github.com_pressly_goose_v3.LICENSE.txt](third_party/licenses/github.com_pressly_goose_v3.LICENSE.txt) |
| `github.com/riverqueue/river` | v0.51.2 | MPL-2.0 | [github.com_riverqueue_river.LICENSE.txt](third_party/licenses/github.com_riverqueue_river.LICENSE.txt) |
| `github.com/riverqueue/river/riverdriver` | v0.51.2 | MPL-2.0 | [github.com_riverqueue_river_riverdriver.LICENSE.txt](third_party/licenses/github.com_riverqueue_river_riverdriver.LICENSE.txt) |
| `github.com/riverqueue/river/riverdriver/riverpgxv5` | v0.51.2 | MPL-2.0 | [github.com_riverqueue_river_riverdriver_riverpgxv5.LICENSE.txt](third_party/licenses/github.com_riverqueue_river_riverdriver_riverpgxv5.LICENSE.txt) |
| `github.com/riverqueue/river/rivershared` | v0.51.2 | MPL-2.0 | [github.com_riverqueue_river_rivershared.LICENSE.txt](third_party/licenses/github.com_riverqueue_river_rivershared.LICENSE.txt) |
| `github.com/riverqueue/river/rivertype` | v0.51.2 | MPL-2.0 | [github.com_riverqueue_river_rivertype.LICENSE.txt](third_party/licenses/github.com_riverqueue_river_rivertype.LICENSE.txt) |
| `github.com/sethvargo/go-retry` | v0.5.0 | Apache-2.0 | [github.com_sethvargo_go-retry.LICENSE.txt](third_party/licenses/github.com_sethvargo_go-retry.LICENSE.txt) |
| `github.com/tidwall/gjson` | v1.20.0 | MIT | [github.com_tidwall_gjson.LICENSE.txt](third_party/licenses/github.com_tidwall_gjson.LICENSE.txt) |
| `github.com/tidwall/match` | v1.2.0 | MIT | [github.com_tidwall_match.LICENSE.txt](third_party/licenses/github.com_tidwall_match.LICENSE.txt) |
| `github.com/tidwall/pretty` | v1.2.1 | MIT | [github.com_tidwall_pretty.LICENSE.txt](third_party/licenses/github.com_tidwall_pretty.LICENSE.txt) |
| `github.com/tidwall/sjson` | v1.2.5 | MIT | [github.com_tidwall_sjson.LICENSE.txt](third_party/licenses/github.com_tidwall_sjson.LICENSE.txt) |
| `go.uber.org/multierr` | v1.11.0 | MIT | [go.uber.org_multierr.LICENSE.txt](third_party/licenses/go.uber.org_multierr.LICENSE.txt) |
| `golang.org/x/crypto` | v0.59.0 | BSD-3-Clause | [golang.org_x_crypto.LICENSE.txt](third_party/licenses/golang.org_x_crypto.LICENSE.txt) |
| `golang.org/x/sync` | v0.25.0 | BSD-3-Clause | [golang.org_x_sync.LICENSE.txt](third_party/licenses/golang.org_x_sync.LICENSE.txt) |
| `golang.org/x/sys` | v0.50.0 | BSD-3-Clause | [golang.org_x_sys.LICENSE.txt](third_party/licenses/golang.org_x_sys.LICENSE.txt) |
| `golang.org/x/term` | v0.48.0 | BSD-3-Clause | [golang.org_x_term.LICENSE.txt](third_party/licenses/golang.org_x_term.LICENSE.txt) |
| `golang.org/x/text` | v0.44.0 | BSD-3-Clause | [golang.org_x_text.LICENSE.txt](third_party/licenses/golang.org_x_text.LICENSE.txt) |

The `github.com/riverqueue/river` family is MPL-2.0 (file-level copyleft): it is linked unmodified, so the obligations are to keep its license notice and to make its source available (the published module at the version above, https://github.com/riverqueue/river). The Go standard library and `golang.org/x/*` are BSD-3-Clause (the Go Authors); the Go standard library text is `$GOROOT/LICENSE`.
