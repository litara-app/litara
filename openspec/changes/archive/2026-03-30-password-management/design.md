## Context

Litara is a self-hosted single-instance app. Authentication uses JWT (60-minute expiry) backed by bcrypt-hashed passwords in Postgres via Prisma. There is no email-based password reset flow (SMTP is optional), so admin reset must happen out-of-band.

Currently `UsersService` only exposes `findOne`. Password hashing is done in `AdminService.create` using `bcrypt` (cost 10). The frontend Settings page (`SettingsContent`) renders a stack of `Paper` sections — a clean insertion point for a change-password form.

## Goals / Non-Goals

**Goals:**

- Authenticated users can change their own password via the UI (current password required for verification).
- A host administrator can reset any user's password via `docker exec` without needing to log in.

**Non-Goals:**

- Email-based "Forgot Password" flow — not viable without guaranteed SMTP.
- Admin password reset from within the web UI — deliberately excluded to avoid a lateral privilege-escalation surface.
- Password strength enforcement — out of scope for this change.
- Session invalidation after password change — JWT tokens are short-lived (60 min); forced invalidation adds complexity not warranted here.

## Decisions

### 1. Change Password — new `PATCH /api/v1/users/me/password` endpoint

**Decision:** Add the endpoint to `UsersController` (already owns `me/settings`). Implement logic in `UsersService` (add `updatePassword`).

**Alternatives considered:**

- Reuse `AdminController` — rejected; admin guard would require elevated role, defeating the "any user" intent.
- Frontend-only with token re-issue — not feasible without a dedicated auth flow.

**Request body:** `{ currentPassword: string; newPassword: string }`

**Validation:** bcrypt.compare current password against stored hash. On mismatch → 400 Bad Request. On success → bcrypt.hash new password (cost 10) → update DB.

---

### 2. Admin Password Reset — standalone CLI script

**Decision:** Implement as a small standalone Node.js script (`apps/api/src/scripts/reset-password.ts`) compiled alongside the app. It instantiates `PrismaClient` directly (no NestJS boot required) for fast startup and minimal dependencies.

Usage (from Docker host):

```bash
docker exec <container> node dist/apps/api/src/scripts/reset-password.js --email user@example.com --password newpass
# or omit --password to be prompted interactively (readline)
```

**Alternatives considered:**

- **NestJS `ApplicationContext`** (`NestFactory.createApplicationContext`) — works but loads the full module graph (library scanner, chokidar, etc.), making startup slow and potentially triggering side effects.
- **Admin-only API endpoint with secret token** — adds a permanent HTTP attack surface; rejected.
- **`npx prisma studio` workaround** — requires the user to understand the schema; not operator-friendly.

---

### 3. Frontend — add Change Password section to existing Settings page

**Decision:** Add a `ChangePasswordSection` component to `SettingsContent.tsx`, rendered as a new `Paper` block. No new route required — keeps password management co-located with other personal settings.

**Form fields:** Current Password, New Password, Confirm New Password (client-side match validation before submit).

## Risks / Trade-offs

- **No session invalidation** → An attacker who already holds a valid JWT can continue using it for up to 60 minutes after a password change. Mitigation: acceptable given the self-hosted, low-concurrent-user context; can be addressed later by adding a `passwordChangedAt` check in the JWT guard.
- **CLI script compiled separately** → If the script isn't included in the Docker image's build output, the `docker exec` command will fail. Mitigation: verify tsconfig includes the scripts directory; add a note to the Docker/deployment docs.
- **bcrypt cost 10 on reset** → Consistent with existing user creation. If cost needs to increase in future, a single constant should control it.

## Migration Plan

1. No DB schema changes required — `password` field already exists on `User`.
2. Deploy API with new endpoint; frontend can deploy independently (graceful 404 until API is updated).
3. CLI script is compiled into the image — no migration steps needed.
