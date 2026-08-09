## Persistence

Use Redis for state that must be shared across application instances. Redis provides a
central store that every instance can access, while SQLite is file-based and is better
suited to state local to a single instance.
