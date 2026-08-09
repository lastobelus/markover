Renamed the section to “Persistence.”

On Redis versus SQLite: the document doesn’t provide enough context to justify that decision. Is the state shared across multiple application instances? If so, Redis makes sense; if this is a single-node application needing durable relational storage, SQLite may be preferable. I left the recommendation unchanged pending that clarification.