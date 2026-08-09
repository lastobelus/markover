Renamed the section to “Persistence.”

The document doesn’t specify enough requirements to justify Redis over SQLite. Redis makes sense for low-latency state shared across processes or hosts; SQLite may be simpler for durable, single-node persistence. The choice needs those deployment and durability requirements clarified.