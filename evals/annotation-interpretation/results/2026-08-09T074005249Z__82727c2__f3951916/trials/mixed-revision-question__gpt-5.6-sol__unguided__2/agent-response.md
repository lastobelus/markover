Renamed the section to “Persistence.”

On Redis versus SQLite: the document doesn’t yet provide enough context to justify the choice. Redis is appropriate if state must be shared across multiple processes or instances with low-latency access. SQLite may be simpler if the application is single-node and needs durable local persistence. The intended deployment model should determine the choice.