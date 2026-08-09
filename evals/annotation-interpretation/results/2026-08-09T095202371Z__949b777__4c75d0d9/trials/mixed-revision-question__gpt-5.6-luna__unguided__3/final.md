## Persistence

Use Redis for shared state because it is designed for low-latency access from
multiple processes. SQLite would be preferable for a local, file-backed
database, but it is not the choice here because this state is shared.
