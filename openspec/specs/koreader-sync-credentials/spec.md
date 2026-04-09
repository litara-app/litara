## ADDED Requirements

### Requirement: KOReader credentials model

The system SHALL store KOReader sync credentials independently from Litara JWT credentials. Each credential record SHALL have a unique `username`, a `passwordHash` (the MD5 hash as received from the KOReader client), and a non-nullable `userId` FK to a Litara `User`. Credentials are always created through the Litara profile page — never via the KOReader sync API.

#### Scenario: Credentials created via Litara profile

- **WHEN** a logged-in Litara user submits a new KOReader credential (username + password) via the Litara profile page
- **THEN** a `KoReaderCredential` record is persisted with the given username, the MD5 hash of the password, and the user's `userId`

#### Scenario: Username uniqueness enforced

- **WHEN** a `KoReaderCredential` with a given username already exists
- **THEN** no second credential with the same username can be created

#### Scenario: Credential validated on each sync request

- **WHEN** a KOReader sync endpoint receives `x-auth-user` and `x-auth-key` headers
- **THEN** the system looks up the `KoReaderCredential` by username and compares the stored hash to the provided key
- **THEN** access is granted only if the values match exactly

---

### Requirement: KOReader credential self-service in user profile

The system SHALL allow logged-in Litara users to create, view, and delete their KOReader sync credentials from the profile page.

#### Scenario: User views their KOReader sync setup

- **WHEN** a logged-in user visits the KOReader section of their profile
- **THEN** the system displays the sync server URL (e.g., `https://<host>/1`) they should enter in KOReader
- **THEN** if credentials exist, the system displays the KOReader username

#### Scenario: User creates credentials

- **WHEN** a logged-in user submits a new KOReader username and password via the profile page
- **AND** no KOReader credential exists for that user yet
- **THEN** a `KoReaderCredential` linked to that user is created

#### Scenario: User cannot have more than one KOReader credential

- **WHEN** a logged-in user who already has a `KoReaderCredential` tries to create another
- **THEN** the request is rejected with an appropriate error

#### Scenario: User can delete their KOReader credentials

- **WHEN** a logged-in user deletes their KOReader credential via the profile page
- **THEN** the `KoReaderCredential` record is removed and subsequent KOReader sync requests with those credentials are rejected

#### Scenario: Progress attributed to credential's linked user

- **WHEN** a KOReader sync progress update is received
- **THEN** the reading progress is stored under the Litara user account linked to that credential

---

### Requirement: KOReader feature toggle

The system SHALL allow administrators to enable or disable the KOReader sync feature. The feature is disabled by default.

#### Scenario: KOReader sync disabled by default

- **WHEN** the server is started for the first time
- **THEN** `koReaderEnabled` in `ServerSettings` is `false`
- **THEN** all `/1/` endpoints return HTTP 503

#### Scenario: Admin enables KOReader sync via setup stepper

- **WHEN** an admin completes step 4 of the setup stepper and enables KOReader sync
- **THEN** `koReaderEnabled` is set to `true` and all `/1/` endpoints become active

#### Scenario: Disabling KOReader sync takes effect immediately

- **WHEN** an admin sets `koReaderEnabled` to `false`
- **THEN** all `/1/` endpoints return HTTP 503 for all subsequent requests

#### Scenario: KOReader API registration always disabled

- **WHEN** a client sends `POST /1/users/create` regardless of the `koReaderEnabled` setting
- **THEN** the system always returns HTTP 403 with body `{"code":2005,"message":"User registration is disabled."}`
