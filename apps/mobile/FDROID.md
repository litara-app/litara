# F-Droid distribution

Litara is distributed through a **self-hosted F-Droid repository** rather than the
official F-Droid repo. The official repo builds every app from source reproducibly in a
network-isolated, Node-less environment, which is a poor fit for Expo/React Native
(non-reproducible Hermes bytecode, blocked npm fetches, non-deterministic
`expo prebuild`). Instead, CI builds and signs the APK with our own key and publishes it
to a GitHub Release; a central repo (`deranjer/fdroid`) aggregates it into a signed
F-Droid index that users subscribe to once.

## How a release is cut

Releases are **automatic**. To ship a new version:

1. Bump `expo.version` in `apps/mobile/app.json` (e.g. `1.0.0` → `1.0.1`) and merge to
   `main`.
2. `.github/workflows/mobile-release.yml` fires on the push, reads that version, builds a
   release-signed APK, and publishes a GitHub Release `mobile-v1.0.1` with
   `com.litara.mobile-<versionCode>.apk` attached. (It creates the tag itself.)
3. The central `deranjer/fdroid` repo's update job pulls the new APK and regenerates the
   F-Droid index (on a cron, or trigger it manually).

If the version in `app.json` is unchanged, the workflow no-ops — so normal commits to
`apps/mobile/**` don't re-release. You can also run it manually (**Actions → Mobile
Release → Run workflow**) with `force: true` to rebuild an existing version.

`versionCode` is derived from the version as `X*10000 + Y*100 + Z` (so `1.0.1` →
`10001`). Minor and patch must stay below 100. The native `android/` directory is
committed (bare workflow), so CI builds it directly with `./gradlew assembleRelease` —
no `expo prebuild` step in CI.

## Signing key (one-time setup)

Generate a release keystore and keep it backed up **offline** — losing it means users
must uninstall/reinstall to move to a new key:

```bash
keytool -genkeypair -v -keystore litara-release.jks -alias litara \
  -keyalg RSA -keysize 4096 -validity 10000
```

Add these **GitHub Actions secrets** to the ebooker repo (Settings → Secrets and
variables → Actions):

| Secret                      | Value                           |
| --------------------------- | ------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | `base64 -w0 litara-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore store password         |
| `ANDROID_KEY_ALIAS`         | `litara`                        |
| `ANDROID_KEY_PASSWORD`      | key password                    |

The signing wiring lives in `android/app/build.gradle` (`signingConfigs.release`, read
from `-PLITARA_*` gradle properties). **`expo prebuild --clean` regenerates that file** —
if you ever run it, re-apply the `release` signingConfig, the `buildTypes.release`
`signingConfig` line, and the `versionCode`/`versionName` property injection.

## Build locally

```bash
npm ci                       # from the repo root (npm workspaces)
cd apps/mobile/android
./gradlew assembleRelease \
  -PLITARA_STORE_FILE=/abs/path/litara-release.jks \
  -PLITARA_STORE_PASSWORD=... -PLITARA_KEY_ALIAS=litara -PLITARA_KEY_PASSWORD=... \
  -PLITARA_VERSION_NAME=1.0.1 -PLITARA_VERSION_CODE=10001
# -> app/build/outputs/apk/release/app-release.apk
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

## Central F-Droid repo (`deranjer/fdroid`)

A separate, dedicated repo hosts the signed index on GitHub Pages at
`https://deranjer.github.io/fdroid/repo`. One index can carry all of your apps.

Install the F-Droid server tools with **uv**:

```bash
uv tool install fdroidserver      # provides the `fdroid` command
# one-off without installing: uvx --from fdroidserver fdroid <subcommand>
```

One-time init (generates `config.yml` and the **repo index signing key**, which is
separate from the Litara APK key):

```bash
mkdir fdroid && cd fdroid
fdroid init
# set in config.yml: repo_url: https://deranjer.github.io/fdroid/repo
```

The repo's `update.yml` workflow (cron + manual) then:

1. `uv tool install fdroidserver`
2. Pulls the latest APK from each app release:
   `gh release download --repo litara-app/<mobile-repo> --pattern '*.apk' --dir repo/`
   (use a read-only fine-grained PAT for cross-org/private repos — `GITHUB_TOKEN` only
   reads its own repo).
3. Restores the index keystore from secrets and runs `fdroid update --create-metadata`.
4. Deploys `repo/` to GitHub Pages.

## Installing (users)

Add this repository in the F-Droid Android client (the fingerprint is printed by the
first `fdroid update`):

```
https://deranjer.github.io/fdroid/repo?fingerprint=<FINGERPRINT>
```

After it's added, every `mobile-v*` release is offered as an in-client update on the next
index refresh.
