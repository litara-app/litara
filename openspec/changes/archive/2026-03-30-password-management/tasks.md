## 1. API — Change Password Endpoint

- [x] 1.1 Add `updatePassword(userId, currentPassword, newPassword)` method to `UsersService` using bcrypt compare + hash
- [x] 1.2 Add `PATCH /users/me/password` endpoint to `UsersController` with `JwtAuthGuard`, Swagger decorators, and request body DTO
- [x] 1.3 Verify `@ApiBearerAuth()` and Swagger types are correct; run `npm run build` in `apps/api` to confirm no TypeScript errors

## 2. API — Admin CLI Reset Script

- [x] 2.1 Create `apps/api/src/scripts/reset-password.ts` — parses `--email` and optional `--password` args, instantiates `PrismaClient` directly, hashes new password with bcrypt (cost 10), updates user record
- [x] 2.2 Add interactive readline prompt for password when `--password` flag is omitted
- [x] 2.3 Verify `tsconfig.json` for `apps/api` includes the `scripts/` directory in compilation output so the script lands in `dist/`

## 3. Frontend — Change Password Section

- [x] 3.1 Create `ChangePasswordSection` component (fields: Current Password, New Password, Confirm New Password) with client-side match validation
- [x] 3.2 Wire submit to `PATCH /api/v1/users/me/password`; show success notification on 200, display API error message on 400
- [x] 3.3 Add `<ChangePasswordSection />` to `SettingsContent` in `apps/web/src/components/SettingsContent.tsx`

## 4. Verification

- [ ] 4.1 Manually test change password flow: correct current password, wrong current password, mismatched new/confirm fields
- [ ] 4.2 Manually test CLI reset script via `node dist/apps/api/src/scripts/reset-password.js --email ... --password ...` and verify login works with new password

- [x] 4.3 Run `npm run build` from repo root to confirm clean build across all packages
