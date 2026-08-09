## Persistence

Use Redis for shared state. Redis is preferred over SQLite when state must be
shared across processes or instances; SQLite is better suited to local,
single-process persistence.
