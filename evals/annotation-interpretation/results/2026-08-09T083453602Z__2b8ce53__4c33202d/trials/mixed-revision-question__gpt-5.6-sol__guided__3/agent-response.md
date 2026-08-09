Renamed the section to **Persistence**.

On Redis versus SQLite: the document only identifies a need for shared state, so it doesn’t provide enough context to justify the choice. Redis fits state shared across multiple processes or hosts; SQLite may be simpler for single-host, durable storage. The deployment and persistence requirements should determine which is appropriate.