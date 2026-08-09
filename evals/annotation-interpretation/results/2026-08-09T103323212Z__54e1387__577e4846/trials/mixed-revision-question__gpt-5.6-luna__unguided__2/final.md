## Persistence

Use Redis for shared state because it supports access from multiple processes or instances. SQLite is a better fit for single-process or local persistence, so it is not the choice for this shared-state use case.
