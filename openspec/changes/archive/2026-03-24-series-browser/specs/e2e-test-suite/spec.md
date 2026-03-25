## ADDED Requirements

### Requirement: Copyright-free series seed data

The e2e test suite SHALL include a reusable seed helper that creates a copyright-free series fixture in the test database. The fixture SHALL use two L. Frank Baum Oz novels (both public domain in the US): `The Wonderful Wizard of Oz` (sequence 1, 1900) and `The Tin Woodman of Oz` (sequence 12, 1918). The series name SHALL be `"Oz"`, the author SHALL be `"L. Frank Baum"`, and `totalBooks` SHALL be set to `14`. The seed helper SHALL create the `Series`, `Author`, `Library`, `Book`, `BookAuthor`, and `SeriesBook` records needed to exercise the series browser endpoints and UI.

#### Scenario: Oz series seed data is usable in tests

- **WHEN** the `seedOzSeries(db)` helper is called with a test database instance
- **THEN** the database contains a `Series` record named `"Oz"` with `totalBooks = 14` and two associated `Book` records with sequence numbers 1 and 12, both attributed to `"L. Frank Baum"`

---

### Requirement: Series browser e2e tests

The system SHALL have e2e tests covering the series list API and series detail API. Tests SHALL use the Oz series seed data. Tests SHALL cover: listing series returns correct aggregated data, retrieving series detail returns books in sequence order, 404 for unknown series id, and 401 for unauthenticated requests.

#### Scenario: List series returns Oz series with correct data

- **WHEN** an authenticated user sends `GET /api/v1/series` after seeding the Oz fixture
- **THEN** the response contains a series entry with `name: "Oz"`, `ownedCount: 2`, `totalBooks: 14`, `coverBookIds` containing at least 1 entry, and `authors` containing `"L. Frank Baum"`

#### Scenario: Series detail returns books in sequence order

- **WHEN** an authenticated user sends `GET /api/v1/series/:id` for the Oz series
- **THEN** the response books array has the sequence-1 book first and the sequence-12 book second

#### Scenario: Unknown series returns 404

- **WHEN** an authenticated user sends `GET /api/v1/series/nonexistent-id`
- **THEN** the response is 404

#### Scenario: Unauthenticated series list returns 401

- **WHEN** an unauthenticated request is sent to `GET /api/v1/series`
- **THEN** the response is 401
