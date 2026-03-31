## ADDED Requirements

### Requirement: CLI script for admin password reset

The system SHALL provide a compiled Node.js script (`dist/apps/api/src/scripts/reset-password.js`) that an administrator can run inside the Docker container to reset any user's password without requiring a valid session.

#### Scenario: Successful reset with explicit password flag

- **WHEN** the script is invoked with `--email <email> --password <newpass>` and the email matches an existing user
- **THEN** the script updates the user's stored password hash and exits with code 0, printing a confirmation message

#### Scenario: Interactive prompt when password flag is omitted

- **WHEN** the script is invoked with `--email <email>` and no `--password` flag
- **THEN** the script prompts the operator to enter a new password interactively (input hidden) and proceeds on entry

#### Scenario: Unknown email exits with error

- **WHEN** the script is invoked with an `--email` that does not match any user
- **THEN** the script prints an error message and exits with a non-zero code without modifying any data

#### Scenario: Missing email argument exits with usage

- **WHEN** the script is invoked without `--email`
- **THEN** the script prints usage instructions and exits with a non-zero code

#### Scenario: Script is accessible via docker exec

- **WHEN** an operator runs `docker exec <container> node dist/apps/api/src/scripts/reset-password.js --email <email> --password <pass>`
- **THEN** the command completes successfully and the user can log in with the new password
