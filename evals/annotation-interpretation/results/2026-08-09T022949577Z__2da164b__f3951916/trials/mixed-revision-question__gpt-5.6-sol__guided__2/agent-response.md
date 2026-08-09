Renamed the section to “Persistence.”

On Redis versus SQLite: the document doesn’t provide enough context to justify that choice. Is Redis required for shared state across multiple processes or instances? If not, SQLite may be the simpler option.