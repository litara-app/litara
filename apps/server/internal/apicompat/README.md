# API compatibility (ADR-0082)

`/api/v1` must never break a third-party client. This package decides, mechanically, whether the generated OpenAPI document is still compatible with what has been promised. `go test ./...` runs the check (`TestAPIStaysBackwardCompatible`), so nothing depends on CI.

## What is promised

- Within `v1` only additive change is allowed: new endpoints, optional parameters and request properties, response properties, error statuses and enum values. Clients must ignore unknown response properties and enum values.
- Anything else is breaking: removing or renaming operations, `operationId`s, parameters or properties; changing types, formats or locations; new required request fields; tighter request limits; looser response guarantees; removing a success status or a response header; changing security. A breaking change needs a new major version (`/api/v2`) served beside `v1`.
- Component schema names are part of the promise (ADR-0108), because generated clients name their types after them. Wherever a client already reaches a schema, its name must not change, be dropped for an inline schema, or be added to one. Names under new operations or properties, and components nothing reaches, are free. The server takes names from Go type names, so renaming a Go type can break the check. Each pair of names is one change, with one waiver ID however many places use it: `schema-name-changed Old -> New` (`(inline)` stands for no name).

## Files (`snapshots/`, built into the binary)

| File | Meaning |
| --- | --- |
| `state.json` | `stability` (`development` or `stable`) and the full `version`. The OpenAPI `info.version` and discovery's `apiVersion` and `stability` come from it. |
| `baseline.openapi.json` | The working baseline while in development. Removed at the first release. |
| `history/<version>.openapi.json` | An immutable released snapshot. |
| `ledger.json` | Every release with the SHA-256 of its snapshot. The check fails if a snapshot is edited, and the API must be compatible with every one. |
| `waivers.json` | Development only. A named breaking change allowed once, with a reason. Consumed by `update` and kept in `history/waived.json`. |

## Workflow

```powershell
go run ./cmd/ctl api-baseline check              # verify (also run by go test)
go run ./cmd/ctl api-baseline update             # development: accept an additive change into the baseline (refuses breaks)
go run ./cmd/ctl api-baseline release 1.0.0      # freeze: first release ends development, waivers are no longer allowed
go run ./cmd/ctl api-baseline release 1.1.0      # after release, additions need a new minor version
```

Run from `apps/server`. After the first release, the generated API must equal the latest snapshot or be a compatible, released addition.
