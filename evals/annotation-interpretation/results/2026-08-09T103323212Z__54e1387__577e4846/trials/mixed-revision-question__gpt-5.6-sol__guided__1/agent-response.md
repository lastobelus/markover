Renamed the section to “Persistence.”

On Redis versus SQLite: the document doesn’t provide enough deployment or workload context to justify that choice. Is Redis required because multiple application instances need network-accessible shared state? If so, I can add that rationale; otherwise SQLite may be worth reconsidering.