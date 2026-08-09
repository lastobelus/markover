Renamed the section to “Persistence.”

Regarding Redis versus SQLite: Redis makes sense when shared state must be accessible across processes or instances; SQLite is simpler for local or single-process persistence. The document doesn’t currently state which constraint drives the choice—should we add that rationale?