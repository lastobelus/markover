Renamed the section to “Persistence.”

On Redis versus SQLite: Redis fits low-latency state shared across multiple processes or instances, while SQLite better suits durable relational storage. The document doesn’t provide enough architectural context to justify Redis more specifically, so I left the existing claim unchanged rather than inventing a rationale.