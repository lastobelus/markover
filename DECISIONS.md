# Prototype decisions

These choices optimize for proving the happy path. They are not intended as a
foundation for a production architecture.

## Data and parsing

1. **The tree is the review artifact.** It contains the exact Markdown source,
   its SHA-256 checksum, structural nodes, and annotations.
2. **Node IDs are document-order IDs.** IDs such as `block-7` are deterministic
   for an exact document. No attempt is made to preserve annotations across
   edits; a changed checksum means a different review target.
3. **Parsing is a small line scanner.** It recognizes ATX headings, ordered and
   unordered list items, indentation-based nested list items, and fenced code
   blocks. Unsupported non-empty lines are counted and omitted from the visual
   tree.
4. **Heading and list structure share one tree.** Lower-level headings become
   children of the nearest higher-level heading. Nested list items become
   children of the preceding less-indented list item.

## Interaction

1. **Selection is always a block, never the invisible document root.**
2. **Arrow navigation operates structurally.** Left selects a parent; right
   selects a child or searches outward for the next sibling; up/down move among
   siblings and climb outward at boundaries.
3. **Tab and Shift-Tab both switch panes.** With only two panes, wrapping in
   either direction has the same visible result.
4. **Annotations are in-memory only.** This is enough to test whether block-level
   review is useful before choosing a file format or persistence model.

## Agent handoff

1. **Clipboard is the integration.** The reviewer can copy concise Markdown
   feedback into any agent thread without coupling the prototype to one agent
   product.
2. **Full JSON remains available.** Copying the annotated tree lets an agent or
   a later tool work with the exact structured artifact.

## Deliberately deferred

- CommonMark compliance and rich inline rendering
- Annotation import, save, merge, migration, or recovery
- Matching annotations across document edits
- Direct agent-thread APIs
- Multiple open documents
- Security hardening, accessibility, packaging, signing, and auto-update
- Compatibility guarantees for the tree format
