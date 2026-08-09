## Persistence

Use Redis for shared state because it provides a network-accessible shared store. SQLite is embedded and file-backed, so using it for shared state would require coordinating access to the database file.
