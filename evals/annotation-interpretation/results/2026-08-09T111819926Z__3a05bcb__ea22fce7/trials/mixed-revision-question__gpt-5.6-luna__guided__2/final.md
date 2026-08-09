## Persistence

Use Redis for shared state. Redis provides a centralized store that can be accessed by multiple processes or application instances with low latency. SQLite is a good fit for local, file-backed persistence, but it is less suitable when state must be shared across instances.
