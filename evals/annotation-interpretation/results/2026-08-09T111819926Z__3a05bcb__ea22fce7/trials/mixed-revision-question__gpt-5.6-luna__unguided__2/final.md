## Persistence

Use Redis for shared state because it provides a network-accessible store for consumers that need to share data. Use SQLite instead when the state is local to a single process or host and does not need concurrent shared access.
