Renamed the section to “Persistence.”

Redis remains specified because the document calls for shared state. If that state does not need to span multiple application instances, SQLite may be simpler; the current document lacks enough requirements to justify ruling it out.