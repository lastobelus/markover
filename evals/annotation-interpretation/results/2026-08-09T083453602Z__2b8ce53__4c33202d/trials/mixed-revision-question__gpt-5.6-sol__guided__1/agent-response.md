Renamed the section to “Persistence.”

On Redis versus SQLite: the document doesn’t provide enough context to justify that choice. Redis may suit state shared across multiple instances, while SQLite may be simpler for durable local persistence. I left Redis unchanged pending clarification on deployment, concurrency, and durability requirements.