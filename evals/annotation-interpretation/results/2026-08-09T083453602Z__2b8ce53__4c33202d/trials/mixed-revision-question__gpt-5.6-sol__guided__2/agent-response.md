Renamed the section to “Persistence.”

On Redis versus SQLite: the document only identifies a need for shared state, which doesn’t fully justify the choice. Could you clarify the expected concurrency, durability, and deployment requirements so we can document why Redis is preferable?