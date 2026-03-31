## ADDED Requirements

### Requirement: Authenticated user can change their own password

The system SHALL provide an API endpoint `PATCH /api/v1/users/me/password` that allows an authenticated user to update their password by supplying their current password and a new password.

#### Scenario: Successful password change

- **WHEN** an authenticated user sends `PATCH /api/v1/users/me/password` with a valid `currentPassword` matching their stored hash and a non-empty `newPassword`
- **THEN** the system updates the user's stored password hash and returns HTTP 200

#### Scenario: Incorrect current password rejected

- **WHEN** an authenticated user sends `PATCH /api/v1/users/me/password` with a `currentPassword` that does not match their stored hash
- **THEN** the system returns HTTP 400 with a message indicating the current password is incorrect and does NOT update the stored password

#### Scenario: Missing fields rejected

- **WHEN** an authenticated user sends `PATCH /api/v1/users/me/password` with either `currentPassword` or `newPassword` absent or empty
- **THEN** the system returns HTTP 400

#### Scenario: Unauthenticated request rejected

- **WHEN** a request is made to `PATCH /api/v1/users/me/password` without a valid JWT
- **THEN** the system returns HTTP 401

### Requirement: Change Password UI section in Settings

The system SHALL display a "Change Password" section within the user Settings page, containing fields for current password, new password, and confirm new password.

#### Scenario: Passwords do not match — client-side validation

- **WHEN** a user enters a new password and confirm password that do not match
- **THEN** the form displays a validation error and disables the submit button until values match

#### Scenario: Successful password change from UI

- **WHEN** a user fills in the correct current password, a new password, and matching confirm password, then submits
- **THEN** the form calls `PATCH /api/v1/users/me/password`, clears the fields on success, and shows a success notification

#### Scenario: Wrong current password shown as error

- **WHEN** the API returns HTTP 400 (incorrect current password)
- **THEN** the form displays the error message returned by the API without clearing any fields
