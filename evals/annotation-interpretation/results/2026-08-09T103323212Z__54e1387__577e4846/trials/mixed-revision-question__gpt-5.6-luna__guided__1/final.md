## Persistence

Use Redis for shared state because it supports low-latency access across processes. SQLite is suitable for local, file-backed persistence, but Redis is the chosen default for shared runtime state.
