## Persistence

Use Redis for shared state because it is designed to be accessed by multiple processes or instances. SQLite is file-based, so using it for shared state would require a shared filesystem and coordination around concurrent access.
