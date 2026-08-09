Renamed the section to “Persistence.”

Regarding Redis versus SQLite: the document doesn’t provide enough project context to justify that choice. Redis fits shared, fast-access state; SQLite may be preferable for durable relational data. Please clarify the persistence requirements before changing the recommendation.