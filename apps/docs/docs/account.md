---
sidebar_position: 4
---

# Account & Password

## Changing your password

You can change your login password at any time from the **Settings** page.

1. Open the **Settings** page from the sidebar.
2. Scroll to the **Change Password** section.
3. Enter your **current password**, then your **new password** twice to confirm.
4. Click **Change password**.

If your current password is incorrect, an error message will appear and your password will not be changed. On success, the form clears and shows a confirmation.

## Admin password reset (Docker)

If a user forgets their password and cannot log in, an administrator with access to the Docker host can reset it directly from the container — no web UI login required.

```bash
docker exec <container-name> node dist/apps/api/src/scripts/reset-password.js \
  --email user@example.com \
  --password newpassword
```

To be prompted for the password interactively (input hidden):

```bash
docker exec -it <container-name> node dist/apps/api/src/scripts/reset-password.js \
  --email user@example.com
```

Replace `<container-name>` with the name of your API container (e.g. `litara-api-1`). After running the command, the user can log in with the new password immediately.
