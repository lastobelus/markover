Renamed the section to “Persistence.”

On Redis versus SQLite: the current text doesn’t provide enough requirements to justify that choice. Shared state alone doesn’t rule out SQLite; the document needs more context about concurrency, deployment, latency, and durability before adding a rationale.