## Persistence

Use Redis for shared state because it provides low-latency access across processes. SQLite is a better fit for durable, single-node persistence; use it instead when shared access is not required.
