# ADR-0076: T006 KOReader device credentials and retained conflicts

Status: Accepted
Date: 2026-11-16
Decision owner: Repository owner

## Context

The pinned KOReader API sends a document digest, opaque progress, percentage and device fields, but no Litara base revision or operation ID. A GET response does not prove an offline local position was based on that response. A naive last-received write or automatic GET-based rebase would violate ADR-0015.

## Decision

On 2026-11-16 the user chose one revocable sync credential per device, read-before-update behavior and retained conflicts rather than overwriting another device. Give each credential an opaque unique protocol username and a generated high-entropy password; KOReader sends the password's MD5 as x-auth-key, so store a slow verifier of that transmitted key and never treat MD5 as a secure password verifier by itself.

Maintain a server-issued revision and device baseline in the separate KOReader source. Reads observe the current server record but must not silently advance an already-stale device baseline or bless queued old writes. On an empty source a credential can establish revision zero after its read. After its own accepted write, advance only that credential's baseline. A different-device write, missing baseline, changed bytes or unresolved candidate keeps canonical state unchanged and records a private durable candidate. The stock protocol gets an explicit failure (409 with a bounded KOReader-style error body); web settings show and resolve the candidate. Using a candidate or adopting the saved position is an explicit owner action against the current revision; only then may the device establish a fresh baseline on its next read.

Do not claim native compare-and-swap or exactly-once semantics for the stock protocol. Deduplicate identical payload retries per credential/file/version. Replay an accepted success only while that result is still canonical; if state changed, retain a candidate rather than reapply or claim current success. Repeated refusals keep the original candidate without another revision/conflict. An intentional exact return to a retained resolved place uses a new explicit owner reapply operation; the original evidence remains immutable. An explicit resolution is not permission for an automatic retry of the old request to undo it. A changed-payload/competing update is retained, not chosen by percentage, device label or clock. The detailed read/write/receipt transitions are in contracts/t006/README.md.

One credential is for one KOReader installation; device_id is advisory and cannot authorize another user. Sharing credentials defeats device isolation and is unsupported. Revoke/disable checks happen on every request. Keep candidates and receipts under ADR-0043; no automatic pruning.

## Alternatives

Last received upload wins; infer causality from client timestamps or GET alone; patch the KOReader client; or keep every device permanently independent. The user selected shared KOReader-only state with per-device credentials and explicit conflicts. The conservative adapter adds conflict prompts at device handoff because the stock protocol cannot echo a revision.

## Consequences

The agent must prove the compatibility boundary with the pinned unmodified client or a faithful captured request sequence before claiming interoperability. If a client cannot surface the specified failure or restore a server position, report the concrete gap; do not return false success or silently weaken conflict protection. This adds credential/binding/conflict settings flows but no new cross-engine synchronization.

## Verification

Exercise A/B reads, accepted backward writes, competing updates, a stale device reading before replaying its old upload, acknowledgement loss, repeated candidates, same/different payload after resolution, concurrent resolves, account switch/revocation, new credentials, replacement and server restart. Show canonical state unchanged for retained candidates and no mutation to web/Android or completion.

These are implementation acceptance requirements. Preparation checks do not establish runtime or third-party-client success.

## Open questions

None within this T006 assignment boundary. Release/hardware verification remains T007.
