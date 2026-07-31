# Prototype decisions

These choices optimize for proving the happy path. They are not intended as a
foundation for a production architecture.

## Data and parsing

1. **The tree is the review artifact.** Its `sourceDocument` contains the exact
   Markdown content, its SHA-256 checksum, name, and path when known. Structural
   nodes store reviewer comments in a plainly named `feedback` field.
2. **Node IDs are document-order IDs.** IDs such as `block-7` are deterministic
   for an exact document. No attempt is made to preserve annotations across
   edits; a changed checksum means a different review target.
3. **Parsing uses markdown-it's CommonMark preset.** Its token stream and source
   maps provide proven block parsing, exact line ranges, hard-wrapped list-item
   content, and room for extensions without maintaining a Markdown grammar.
   Markover currently turns paragraphs, headings, ordered and unordered list
   items, thematic breaks, and code blocks into selectable nodes. The built-in
   table rule is enabled explicitly.
4. **Heading and list structure share one tree.** Lower-level headings become
   children of the nearest higher-level heading. Nested list items become
   children of the preceding less-indented list item.
5. **Block quotes and tables are deliberately opaque nodes.** Their complete
   source ranges are selectable and their contents render, but markdown-it's
   nested quote tokens and table rows/cells are not copied into the review tree.
   This tests useful review granularity before adding more navigation levels.
6. **Tasks decorate ordinary list-item nodes.** A leading `[ ]`, `[x]`, or `[X]`
   adds `task` and `checked` fields and is removed from the displayed item text.
   The original marker remains present in the node's raw source.
7. **Inline Markdown is rendered inside supported blocks.** Bold, italic,
   inline code, link labels, and image labels appear in the left pane. Links and
   images are deliberately inert; hovering reveals their destination or path.
8. **Unrecognized extensions degrade through CommonMark.** With raw HTML and
   extensions disabled, syntax such as definition lists, footnotes,
   strikethrough, and HTML may appear as literal paragraph content, resolve as
   ordinary reference syntax, or have definition lines absent from the block
   tree. The exact input remains in `sourceDocument.content`; the sampler keeps
   these cases visible for a later unsupported-syntax design.

## Interaction

1. **Selection is always a block, never the invisible document root.**
2. **Arrow navigation operates structurally.** Left selects a parent; right
   selects a child or searches outward for the next sibling; up/down move among
   siblings and climb outward at boundaries.
3. **Tab and Shift-Tab both switch panes.** With only two panes, wrapping in
   either direction has the same visible result.
4. **Ordinary app feedback is in-memory; dogfooding reviews autosave.** A review
   opened through `review:open` atomically writes its complete tree after every
   mutation to `.markover/reviews/<review-id>/review.json`. The same review ID
   can restore that tree after Electron or its launching agent process exits.
5. **Structural labels do not repeat source markers.** Headings use `H1`, `H2`,
   and so on; ordered items use their actual index; unordered items use an open
   bullet. The block text contains only the item's content.
6. **Ancestors reveal feedback below them.** A block with feedback has a solid
   marker. An ancestor of a block with feedback has a separate, partially
   transparent marker, so collapsed branches do not hide review state. The
   indicator order is own annotation, descendant annotation, then attached
   image. Image indicators propagate through descendants without distinguishing
   where in the subtree the image lives. All three columns remain fixed at the
   right edge; nesting indents only the disclosure and content columns.
7. **The annotation pane includes compact raw source.** Its header contains the
   node type and source line span; list items also show their position and list
   length. A collapsible source panel preserves the selected block's original
   Markdown without hard-wrapping and uses a small monospace font.
8. **The selection remains visible while reading forward.** Once the selected
   row scrolls above the document viewport, a non-interactive mirror stays
   pinned at the top. Content scrolls beneath its opaque background and shadow;
   a small centered accent triangle distinguishes the pinned state. The pinned
   row's top hairline replaces the document header's bottom hairline rather than
   rendering as a fuzzy pair.
9. **Hover and selection bands are square and full-bleed.** Rows retain content
   indentation but their backgrounds and top/bottom borders reach the left edge
   of the pane. There are no side borders or rounded corners. A small,
   pointer-inert overlay completes the active band over the native scrollbar;
   pinned rows sit above the entire scroll surface. The document pane's right
   divider uses the same hairline color as selected rows.
10. **Pane headers are compact and geometrically shared.** Both use the same
    fixed 40-pixel height and aligned bottom border. Their pane labels sit in
    the top-left corner, the selected block descriptor is centered, and status
    pills remain right-aligned.
11. **Pane focus is an external top-edge signal.** The focused pane replaces
    its one-pixel header-top hairline with a four-pixel accent line extending
    upward, so its bottom edge remains aligned with the other pane's hairline.
    No green outline surrounds the pane.
12. **Navigation help is inset from the scrollbar.** Its right-side gap from
    the scrollbar visually matches its bottom gap from the window.
13. **Annotation typing does not rebuild the tree per character.** The document
    tree only rerenders when a block crosses the annotated/unannotated boundary,
    and that rerender preserves `scrollTop`. Browser scroll anchoring is disabled
    for the tree so feedback entry cannot walk the document one block at a time.

## Screenshot attachments

1. **Pasted screenshots are workspace files, not JSON payloads.** The default
   base directory is the gitignored `.markover/attachments/`. Each app run gets
   a unique subdirectory, and `--attachments-dir <path>` overrides the base.
   Emitted paths are absolute so a same-workspace agent can inspect them
   directly.
2. **Attachments and prose remain separate data.** A node gains an ordered
   `attachments` array only when an image is pasted. Each entry contains an ID,
   type, MIME type, absolute path, byte checksum, pixel dimensions, and optional
   short label. The original pasted PNG or JPEG bytes are written unchanged.
3. **Pasting also inserts a convenient textual reference.** Markover inserts
   `[!img-N]` at the feedback cursor after saving an image. The attachment array
   is authoritative: deleting or editing the marker does not affect the image.
   Removing an attachment through the UI also removes exact matching markers.
   If the browser paste event exposes no image item, Markover falls back to
   Electron's native clipboard image so copies from Preview and Finder work.
4. **The first-cut UI supports ordered multiple images.** Thumbnails appear
   below feedback in paste order and wrap into rows without horizontal
   scrolling. Each card places a 78-by-42-pixel thumbnail above its short label
   and delete button. A normal click opens a large preview; Control-click
   anywhere on the attachment card replaces its label with an inline editor.
   On macOS the equivalent context-menu event follows the same path because a
   physical Control-click may not retain `ctrlKey` on the pointer event.
   Enter or blur commits, while Escape cancels. Holding Control suppresses the
   delete hover/action. Relabeling replaces matching `[!img-N]` references with
   `[!label]` in the feedback. A small `▧` after the annotation markers shows
   which document subtrees contain images.
5. **There is no image editor or dedicated caption field.** Pasted images are
   not cropped, drawn on, highlighted, or recompressed. Short thumbnail labels
   aid reference; explanatory prose remains in `feedback`.
6. **Attachment files have no automatic cleanup.** Cancel, Done, and attachment
   removal leave files on disk. If `.markover/` grows too large, cleanup happens
   out of band.

## Agent handoff

1. **A blocking CLI is the primary integration.** An agent can pass a Markdown
   path or pipe Markdown to `npm --silent run review`, wait while the reviewer
   works, then continue with the emitted JSON.
2. **Stdout is a strict machine interface.** Done emits exactly one
   `markover-review` JSON object and exits successfully. Cancel, window close,
   and invalid input exit non-zero without emitting JSON. Diagnostics belong on
   stderr.
3. **Clipboard handoff uses the complete tree.** The ordinary app exposes one
   primary `Copy feedback JSON` action. A second concise-feedback format was
   removed because annotations are substantially less useful without their tree
   context.
4. **Image handoff uses ordinary paths.** Full-tree JSON includes attachment
   metadata directly on annotated nodes.
5. **Long human reviews launch outside the agent process tree.** The
   `review:open` command registers a user `launchd` job on macOS, prints its
   review ID and autosave path, and exits. `review:open --resume <review-id>`
   reloads the atomically saved tree. This dogfooding path uses Copy feedback
   JSON rather than stdout-based Done.

## Deliberately deferred

- Drill-down into block-quote contents or table rows and cells
- Footnote, definition-list, strikethrough, container, and other extension nodes
- Explicit warnings and selectable fallback nodes for unsupported syntax
- Annotation import, save, merge, migration, or recovery
- Matching annotations across document edits
- Direct agent-thread APIs beyond the blocking CLI
- Multiple open documents
- Security hardening, accessibility, packaging, signing, and auto-update
- Compatibility guarantees for the tree format
