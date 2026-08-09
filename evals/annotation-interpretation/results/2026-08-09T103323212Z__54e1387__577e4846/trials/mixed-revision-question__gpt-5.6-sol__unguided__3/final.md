## Persistence

Use Redis for state that must be shared across application instances. Unlike Redis, SQLite is an embedded, file-backed database, so sharing it across independently deployed instances would require additional filesystem and coordination infrastructure.
