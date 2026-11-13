# Litara Android: current status

This directory is the **imported BookOrbit Android baseline** (see [UPSTREAM.md](UPSTREAM.md)). It is
the agreed starting point for Litara's native Android client (ADR-0005), not yet a Litara client.

- **Identity renamed:** application ID `com.litara`, package `com.litara.*`, scheme `litara://`, Litara
  logo/icons, version `0.1.0` (see `UPSTREAM.md`). Release signing and Play publishing wiring remain inert.
- **Still BookOrbit-shaped:** networking, DTOs, API routes, auth/refresh transport and local storage layout. The BookOrbit networking layer is **temporary baseline code, pending
  replacement** by a Litara API adapter. It is not a compatibility layer and must not be extended.
- **Preserved unchanged in this increment:** player, chapters, Cast proxy/handoff, Android Auto,
  downloads, restore behavior, and both the `full` and Cast-free `fdroid` flavors.
- **Does not talk to the Litara Go backend.**
- **Known defect carried over:** local downloads and progress are partitioned per *server*, not per
  authenticated *account*. Passing the old tests does not resolve it. See
  [ADAPTATION.md](ADAPTATION.md) §3.
- **No release:** this baseline must not be published, signed or distributed. The BookOrbit Android
  product is being deprecated and eventually withdrawn.

Read in this order: [LICENSING.md](LICENSING.md), [UPSTREAM.md](UPSTREAM.md),
[ADAPTATION.md](ADAPTATION.md), [BUILDING.md](BUILDING.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
