## Persistence

Use Redis for shared state because it provides low-latency access to data shared across processes. SQLite is better suited to durable, file-based local storage and is not the intended mechanism for shared state.
