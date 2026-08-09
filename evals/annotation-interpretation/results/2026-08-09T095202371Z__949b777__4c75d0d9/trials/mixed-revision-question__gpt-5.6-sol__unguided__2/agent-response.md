Renamed the section to “Persistence.”

On Redis versus SQLite: the document doesn’t include enough architectural context to justify that choice. What requirements drove Redis—such as multi-instance coordination, ephemeral state, or latency needs? If none apply, SQLite may be the simpler option.