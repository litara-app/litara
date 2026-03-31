## Why

Users currently have no way to change their password from the UI, and there is no mechanism for administrators to reset a forgotten password — leaving users permanently locked out if they forget credentials. This is a critical gap for a self-hosted application where the user is also the admin.

## What Changes

- Add a **Change Password** form in the user account/settings area of the UI, allowing logged-in users to update their own password.
- Add a **CLI-based password reset** command intended for administrators to run inside the Docker container (e.g., `docker exec <container> node dist/... reset-password --username <user>`). This deliberately bypasses the UI to prevent unauthenticated password resets.
- No email-based reset flow — Litara is self-hosted with optional/no SMTP, and the host has direct container access.

## Capabilities

### New Capabilities

- `change-password`: Allows an authenticated user to change their own password via the settings UI. Requires current password confirmation before accepting a new one.
- `admin-password-reset`: A CLI command (runnable via `docker exec`) that lets the host administrator reset any user's password without needing to log in. Accepts `--username` and optionally `--password` (or prompts interactively).

### Modified Capabilities

<!-- No existing specs have requirement-level changes -->

## Impact

- **API**: New `PATCH /api/v1/users/me/password` endpoint (authenticated). Possibly a new NestJS CLI command or standalone script for admin reset.
- **Frontend**: New "Change Password" section in a user settings/account page (may require creating a settings route if one doesn't exist).
- **Auth**: Password hashing via existing bcrypt utilities; no new dependencies expected.
- **Docker**: Admin reset is invoked via `docker exec` — no new ports, services, or env vars required.
