Updated `document.md`:

- Renamed “Storage” to “Persistence”
- Added rationale for Redis over SQLite and clarified when SQLite is appropriate

Redis is preferred for low-latency shared state across processes, while SQLite suits durable single-node persistence.