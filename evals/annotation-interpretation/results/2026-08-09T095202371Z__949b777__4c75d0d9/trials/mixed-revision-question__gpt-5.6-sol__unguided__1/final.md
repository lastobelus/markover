## Persistence

Use Redis for state that must be shared across application instances. Unlike SQLite, Redis does not depend on every instance having access to the same database file. If the application is deployed as a single instance and does not need distributed state, prefer SQLite for its simpler operation and durable local storage.
