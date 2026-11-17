# ADR-0074: T006 SMTP ownership and recoverable delivery

Status: Accepted
Date: 2026-11-16
Decision owner: Repository owner

## Context

The archived mail service sends synchronously and cannot distinguish an SMTP acceptance from a lost response. The rebuild already has durable PostgreSQL/River jobs and versioned library authorization. SMTP passwords are recoverable secrets, unlike app credential verifiers.

## Decision

On 2026-11-16 the user selected administrator-managed server SMTP plus optional personal SMTP, user-owned saved recipients, explicit sends, and review rather than automatic resend when the server may already have accepted a message. Ebook/comic originals and individual original audio files are included. Implementation/testing must use a local mail sink and synthetic recipients only.

Users may configure only their personal transport and recipients; administrators configure the server transport. The request explicitly chooses personal or server SMTP and names an owned saved recipient plus exact file/version. Never silently fall back to another transport. Deliver one original attachment per request; no conversion, bundling or automatic campaigns. Recheck enabled account, current library grant, recipient ownership, file version, and selected active transport before irreversible submission.

Persist the delivery request, operation receipt and job transactionally. Identical API retries return the same delivery. Use bounded retries only for a known pre-acceptance transient failure. Persist the attempt boundary before DATA can finish; if the worker restarts there or loses the final acknowledgement, mark outcome_unknown and do not resend automatically. SMTP accepted means accepted by the next server, not delivered to an inbox. A deliberate resend is a new operation referencing the prior delivery and explicitly acknowledging possible duplication.

Store SMTP secrets with authenticated encryption using an operator-supplied dedicated versioned key; never derive it from login/session secrets or return password fragments. Mask secret presence only. Missing/wrong keys fail closed without deleting configuration. TLS modes are required STARTTLS or implicit TLS with certificate validation; plaintext is an explicit local-test-only option.

## Alternatives

Server-only SMTP; personal-only SMTP; silent fallback; synchronous delivery; automatic retry after ambiguous acceptance; or claiming exactly-once email. The user chose dual ownership and review of uncertain results.

## Consequences

Settings and delivery status require web UI and real API coverage. Revocation cannot recall bytes already submitted; report that boundary. Configuration revisions and recipient/file snapshots must prevent silently redirecting a queued request after edits. Delivery audit/error responses must not expose transport passwords or another user's address/history. Operator limits and an application-level retry bound belong in the execution contract.

## Verification

Local sink tests: both transports, owned recipients, original attachment hashes and MIME, header injection refusal, duplicate API calls, concurrent workers, safe transient retry, permanent failure, acknowledgement loss, restart after submission boundary, explicit resend, disabled account/revoked grant, changed file/config/recipient, unavailable key and TLS failure. Assert uncertain attempts never cause an automatic second SMTP transaction.

These are implementation acceptance requirements. Preparation checks do not establish runtime or third-party-client success.

## Open questions

None within this T006 assignment boundary. Release/hardware verification remains T007.
