Renamed the section to “Persistence.”

On Redis versus SQLite: the document doesn’t provide enough context to justify that choice. I left Redis unchanged rather than inventing a rationale. Redis fits shared, low-latency state across instances; SQLite fits durable relational persistence without a separate service. We should clarify the intended workload before documenting the decision.