Renamed the section to “Persistence.”

On Redis versus SQLite: the document only identifies a need for shared state, so it doesn’t provide enough context to justify that choice. Redis may fit if multiple application instances need concurrent access; otherwise SQLite could be simpler. Could you confirm the deployment and persistence requirements?