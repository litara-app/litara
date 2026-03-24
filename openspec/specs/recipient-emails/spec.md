## ADDED Requirements

### Requirement: User can add a recipient email address

The system SHALL allow an authenticated user to add an email address to their personal list of recipient addresses. Each address SHALL store the email, an optional label, and an `isDefault` flag. The first address added SHALL automatically become the default.

#### Scenario: Add first recipient email (becomes default)

- **WHEN** an authenticated user submits a POST request to `/api/v1/users/me/recipient-emails` and they have no existing recipient emails
- **THEN** the system creates the recipient email with `isDefault: true` and returns 201 with the created record

#### Scenario: Add subsequent recipient email (not default)

- **WHEN** an authenticated user submits a POST request to `/api/v1/users/me/recipient-emails` and they already have at least one recipient email
- **THEN** the system creates the recipient email with `isDefault: false` and returns 201 with the created record

#### Scenario: Add duplicate email address

- **WHEN** an authenticated user submits a POST request to `/api/v1/users/me/recipient-emails` with an email address they have already added
- **THEN** the system returns 409 Conflict

#### Scenario: Unauthenticated request is rejected

- **WHEN** an unauthenticated request is made to `POST /api/v1/users/me/recipient-emails`
- **THEN** the system returns 401 Unauthorized

### Requirement: User can list their recipient email addresses

The system SHALL allow an authenticated user to retrieve all of their recipient email addresses, ordered by creation time ascending.

#### Scenario: List recipient emails

- **WHEN** an authenticated user submits a GET request to `/api/v1/users/me/recipient-emails`
- **THEN** the system returns 200 with an array of the user's recipient emails, each including id, email, label, isDefault, and createdAt

#### Scenario: List when no recipient emails exist

- **WHEN** an authenticated user submits a GET request to `/api/v1/users/me/recipient-emails` and they have no recipient emails
- **THEN** the system returns 200 with an empty array

### Requirement: User can delete a recipient email address

The system SHALL allow an authenticated user to delete one of their recipient email addresses. If the deleted address was the default, the system SHALL promote the earliest remaining address to default, or leave no default if none remain.

#### Scenario: Delete a non-default recipient email

- **WHEN** an authenticated user submits a DELETE request to `/api/v1/users/me/recipient-emails/:id` for a non-default address they own
- **THEN** the system removes the address and returns 204 No Content

#### Scenario: Delete the default recipient email (another address exists)

- **WHEN** an authenticated user submits a DELETE request to `/api/v1/users/me/recipient-emails/:id` for their default address and at least one other address exists
- **THEN** the system removes the address, promotes the earliest remaining address to default, and returns 204 No Content

#### Scenario: Delete a recipient email that does not belong to the user

- **WHEN** an authenticated user submits a DELETE request to `/api/v1/users/me/recipient-emails/:id` for an address that belongs to a different user
- **THEN** the system returns 404 Not Found

### Requirement: User can set a default recipient email address

The system SHALL allow an authenticated user to designate one of their recipient email addresses as the default. Setting a new default SHALL atomically unset the previous default within a single database transaction so that at no point is there zero or more than one default address.

#### Scenario: Set a new default

- **WHEN** an authenticated user submits a PATCH request to `/api/v1/users/me/recipient-emails/:id/default` for an address they own
- **THEN** the system executes a transaction that unsets the current default (if any) and sets the new default in a single atomic operation, then returns 200 with the updated record

#### Scenario: Set default when it is already the default

- **WHEN** an authenticated user submits a PATCH request to `/api/v1/users/me/recipient-emails/:id/default` for the address that is already the default
- **THEN** the system returns 200 with the record unchanged (idempotent)

#### Scenario: Set default on an address that does not belong to the user

- **WHEN** an authenticated user submits a PATCH request to `/api/v1/users/me/recipient-emails/:id/default` for an address that belongs to a different user
- **THEN** the system returns 404 Not Found
