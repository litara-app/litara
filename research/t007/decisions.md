# T007 scope decisions and external gates

Recorded: 2026-11-17. Decision owner: repository owner. These are assignment and sequencing choices within accepted architecture; they do not accept new production or migration policies.

The user explicitly selected:

- T007 owns integration fixes and release evidence, including adapting the preserved Android ebook/PDF/comic readers to the Litara APIs.
- Legacy personal-state migration is a separate package. It remains mandatory before release under ADR-0063; T007 cannot waive it.
- Test resources are available in principle. Android work uses emulators. The user can assist with Chromecast network debugging; schedule that last.
- NAS, KOReader app/device and screen-reader work may be coordinated with the user. Exact endpoints, versions, devices, operators and available fixtures have not been supplied. Availability in principle is not completed verification or authorization to access arbitrary user data.

Physical Android phone and real Android Auto/head-unit acceptance have no confirmed resource. Emulator success does not close those gates. Chromecast must remain Pending until an actual receiver and operator are identified and the delayed run occurs.

## Governing accepted decisions

ADR-0005/0011 require preserved Android media and a usable reading/listening release. ADR-0017 preserves the MIT/AGPL boundary. ADR-0027 preserves Android's reader while web uses pristine engines. ADR-0031–0043 govern authorization, downloads, credentials and audio revision/conflict behavior. ADR-0044–0061 govern ingestion, metadata, staged writes and storage. ADR-0065/0066 define exact-file ebook state and personal organization; ADR-0068 explicitly left native reader adaptation for a later owner, now T007. ADR-0070 governs recording successors; ADR-0071 governs web reader origin separation; ADR-0073–0076 govern delivery and KOReader. ADR-0062–0064 retain the release/migration/Actions holds.

No package brief may invent cross-engine locator equivalence. Prove compatibility using both actual renderers and the same file/version. If a native locator cannot fit the existing typed contract without changing its semantics, preserve evidence and propose a decision before dependent canonical sync. Do not claim the web engine profile merely because both readers descend from Foliate. Other integration work can continue.

## Decision requests that remain outside this assignment's authority

- T008: supported legacy sources/export, account/root mapping, conversion coverage, recovery limits and replay rules under ADR-0063. T008 is not implementation-ready or assigned.
- Production: supported OS/CPU/database versions, binary distribution/source obligations and mirror policy, upgrade/migration execution, backup/retention policy, release identity/signing/distribution and automatic-update protection. Inventory and propose these; only explicit user choices authorize them.
- Any change to accepted reader/security/offline/conflict behavior requires the normal ADR process, not a worker's coverage-table disposition.

The worker can finish local implementation and submit evidence with external/release gates open. This is not permission to mark T007 or 2.0.0 fully accepted. No worker is launched by preparation.
