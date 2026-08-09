Renamed the section to “Persistence.”

On Redis versus SQLite: the document only identifies a need for shared state, so the specific rationale isn’t yet clear. I left the implementation statement unchanged rather than inventing architectural constraints. Could you clarify whether Redis is required for multi-instance access, expiration, pub/sub, or another reason?