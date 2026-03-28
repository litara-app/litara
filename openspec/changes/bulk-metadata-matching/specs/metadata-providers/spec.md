## ADDED Requirements

### Requirement: ISBN hint passthrough

The metadata provider services SHALL accept an optional `isbnHint` parameter on their search methods. When an ISBN-13 hint is provided, the provider SHALL use it as the primary search key (ISBN lookup) instead of title+author search. Providers that do not support ISBN-based lookup SHALL ignore the hint and fall back to title+author.

#### Scenario: Provider uses ISBN hint

- **WHEN** enrichBookFromProvider is called with isbnHint set
- **THEN** provider queries its API using the ISBN as the search key, yielding a more precise match than title+author

#### Scenario: Provider ignores unknown ISBN

- **WHEN** ISBN-based lookup returns no results
- **THEN** provider falls back to title+author search automatically

#### Scenario: Provider does not support ISBN lookup

- **WHEN** a provider (e.g. Goodreads scraper) has no ISBN endpoint
- **THEN** provider silently ignores the hint and proceeds with title+author
