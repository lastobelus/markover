Renamed the section to “Persistence.”

On Redis versus SQLite: the document doesn’t provide enough architectural context to justify that choice. Is Redis required because multiple application instances must share state, or is there another requirement? I left the existing recommendation unchanged pending clarification.