## ADDED Requirements

### Requirement: KOReader sync API is mounted at /1/ prefix

The system SHALL expose the KOReader sync protocol endpoints under the URL prefix `/1/`, separate from the existing `/api/v1/` prefix. All five endpoints SHALL be reachable at their KOReader-standard paths.

#### Scenario: Health check endpoint responds

- **WHEN** a client sends `GET /healthcheck` with header `Accept: application/vnd.koreader.v1+json`
- **THEN** the system returns HTTP 200 with body `{"state":"OK"}`

#### Scenario: KOReader routes do not conflict with existing API routes

- **WHEN** the server starts
- **THEN** routes under `/1/` and routes under `/api/v1/` coexist without conflict

---

### Requirement: User registration endpoint always returns disabled

The system SHALL expose `POST /1/users/create` (required by the KOReader protocol) but SHALL always return "registration disabled". Credentials are managed exclusively through the Litara profile page.

#### Scenario: Registration endpoint always rejects

- **WHEN** any client sends `POST /1/users/create` with any body
- **THEN** the system returns HTTP 403 with body `{"code":2005,"message":"User registration is disabled."}`

#### Scenario: KOReader setup completes despite registration error

- **WHEN** a user has pre-created their KOReader credentials via the Litara profile page
- **AND** the KOReader app sends `POST /1/users/create` (showing an error to the user)
- **THEN** the credentials created in Litara are still valid and all sync endpoints function correctly

---

### Requirement: User authentication check endpoint

The system SHALL allow KOReader to verify credentials via `GET /1/users/auth`.

#### Scenario: Valid credentials accepted

- **WHEN** a client sends `GET /1/users/auth` with headers `x-auth-user: alice` and `x-auth-key: <correct-md5>`
- **THEN** the system returns HTTP 200 with body `{"authorized":"OK"}`

#### Scenario: Invalid credentials rejected

- **WHEN** a client sends `GET /1/users/auth` with an incorrect `x-auth-key`
- **THEN** the system returns HTTP 401 with body `{"code":2001,"message":"Unauthorized"}`

#### Scenario: Missing auth headers rejected

- **WHEN** a client sends `GET /1/users/auth` without `x-auth-user` or `x-auth-key` headers
- **THEN** the system returns HTTP 401 with body `{"code":2001,"message":"Unauthorized"}`

---

### Requirement: Update reading progress endpoint

The system SHALL accept reading progress updates from KOReader via `PUT /1/syncs/progress`.

#### Scenario: Valid progress update stored

- **WHEN** an authenticated client sends `PUT /1/syncs/progress` with body `{"document":"<md5>","percentage":0.32,"progress":"56","device":"My Kindle","device_id":"abc123"}`
- **THEN** the system returns HTTP 200 with body `{"document":"<md5>","timestamp":<unix_timestamp>}`
- **THEN** the reading progress for the matching book is upserted in the database

#### Scenario: Progress update for unknown document is stored without book link

- **WHEN** an authenticated client sends `PUT /1/syncs/progress` with a document hash that does not match any known `BookFile`
- **THEN** the system returns HTTP 200 with body `{"document":"<md5>","timestamp":<unix_timestamp>}`
- **THEN** the progress record is saved (document hash stored) even without a book link

#### Scenario: Missing required fields rejected

- **WHEN** an authenticated client sends `PUT /1/syncs/progress` with `document`, `percentage`, or `progress` missing
- **THEN** the system returns HTTP 400 with body `{"code":2003,"message":"Invalid fields."}`

#### Scenario: Unauthenticated progress update rejected

- **WHEN** a client sends `PUT /1/syncs/progress` without valid `x-auth-user` / `x-auth-key` headers
- **THEN** the system returns HTTP 401 with body `{"code":2001,"message":"Unauthorized"}`

---

### Requirement: Get reading progress endpoint

The system SHALL return stored reading progress via `GET /1/syncs/progress/:document`.

#### Scenario: Existing progress returned

- **WHEN** an authenticated client sends `GET /1/syncs/progress/<md5>` for a document with stored progress
- **THEN** the system returns HTTP 200 with body containing `document`, `percentage`, `progress`, `device`, and `timestamp` fields

#### Scenario: No progress returns empty object

- **WHEN** an authenticated client sends `GET /1/syncs/progress/<md5>` for a document with no stored progress
- **THEN** the system returns HTTP 200 with body `{}`

#### Scenario: Invalid document identifier rejected

- **WHEN** an authenticated client sends `GET /1/syncs/progress/` with an empty or colon-containing document string
- **THEN** the system returns HTTP 400 with body `{"code":2004,"message":"Document field is missing."}`

#### Scenario: Unauthenticated progress get rejected

- **WHEN** a client sends `GET /1/syncs/progress/<md5>` without valid auth headers
- **THEN** the system returns HTTP 401 with body `{"code":2001,"message":"Unauthorized"}`
