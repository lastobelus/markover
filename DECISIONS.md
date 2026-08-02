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
3. **Parsing is delegated to the third-party `markdown-it` parser using its
   CommonMark preset.** Markover does not maintain a Markdown grammar. It maps
   `markdown-it`'s token stream and source ranges into review blocks, gaining
   proven block parsing, exact line ranges, hard-wrapped list-item content, and
   room for extensions. Markover currently turns paragraphs, headings, ordered
   and unordered list items, thematic breaks, and code blocks into selectable
   nodes. The built-in table rule is enabled explicitly.
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

   Example task nodes:

   - [ ] Review the pending decision
   - [x] Preserve the accepted behavior
7. **Inline Markdown is rendered inside supported blocks.** Bold, italic,
   inline code, link labels, and image labels appear in the left pane. Links
   remain inert. Image pills open the source image in the same labeled preview
   modal used for screenshot attachments; relative paths resolve from the
   reviewed Markdown file.
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
3. **Tab and Shift-Tab cycle review panes.** When the documents list sidebar is
   expanded, focus cycles through Documents, Document tree, and Annotation.
   A collapsed or absent documents list is skipped. Control-Tab remains reserved
   for switching review sessions.
4. **Managed reviews are durable sessions.** Each `markover open` call creates a
   distinct review ID and atomically writes its complete artifact after every
   mutation to `.markover/reviews/<review-id>/review.json`. Restarting the
   single application instance restores every managed review and its collapse,
   feedback, status, and attachment state. Selection is retained while switching
   tabs during an application run and resets to the first block after restart.
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
   Markdown without hard-wrapping and uses a small monospace font. An explicit
   Edit action creates a proposal in `sourceEdit: { original, current }`; it
   never writes the source document or changes its checksum, `raw`, IDs, or
   structure. Saved proposals render through Pierre Diffs, show line counts in
   the source header and tree row, and replace the tree block's visible content
   while retaining the immutable original for handoff. Revert removes only the
   proposal.
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

1. **Pasted screenshots are workspace files, not JSON payloads.** Managed
   reviews store them under
   `.markover/reviews/<review-id>/attachments/`. Legacy blocking reviews retain
   their gitignored `.markover/attachments/` directory and optional
   `--attachments-dir <path>` override. Emitted paths are absolute so a
   same-workspace agent can inspect them directly.
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
6. **Attachment files have no automatic cleanup.** Removing an attachment from
   a node leaves its bytes on disk. Review-history retention and cleanup remain
   future work.

## Agent handoff

1. **The primary integration is non-blocking `open` plus one-shot `get`.**
   `markover open <path> --summary <text>` registers the exact source in the
   existing application instance, returns a review ID, and exits. After the user
   says “Check Markover,” `markover get <id>` returns the complete review
   without agent polling or clipboard transfer.
2. **A review ID represents one review session.** Opening the same source twice
   creates distinct IDs because branch, pull request, agent thread, purpose, and
   annotations may differ. Source checksums identify the exact Markdown target;
   review ID plus block ID identifies one annotation.
3. **Handoff is atomic and idempotent.** `get` freezes the renderer before
   capturing its latest state, waits for active attachment mutations, persists
   the snapshot, transitions to `pending-agent`, and acknowledges the read-only
   UI before returning. Per-review action serialization prevents concurrent
   `get` and `edit` from interleaving.
4. **The user can reopen editing.** `markover edit <id>` idempotently returns a
   pending review to `editing`. It cannot recall work an agent already performed
   from an older snapshot, so the user must also tell that agent to pause.
5. **Stdout is a strict machine interface.** Agent-facing commands emit exactly
   one JSON value on success. Diagnostics belong on stderr, and failures exit
   non-zero without contaminating stdout.
6. **Clipboard export remains an escape hatch.** `Copy feedback JSON` copies the
   same complete tree. A concise-feedback format remains omitted because
   annotations are substantially less useful without their source and tree
   context.
7. **Image handoff uses ordinary paths.** Full-tree JSON includes attachment
   metadata directly on annotated nodes; image bytes remain outside JSON.
8. **Legacy commands remain temporarily available for comparison.** The
   blocking `review` command and older durable `review:open`/`--resume` path are
   not the primary multi-thread workflow.

## Multi-document application state

1. **One Electron instance owns a review inbox.** A checkout-specific
   single-instance `launchd` service exposes a small loopback JSON API. Startup
   retry stays inside the CLI process and does not spend agent turns polling.
2. **Every managed review has an independent tab.** Switching tabs preserves
   selection, collapsed blocks, annotations, and attachment previews.
   Control-Tab and Control-Shift-Tab cycle reviews.
3. **Pending reviews are localized read-only state.** Tabs show `WITH AGENT`,
   the annotation pane shows `WITH AGENT · READ ONLY`, feedback renders as
   Markdown rather than a textarea, and mutation controls disappear. Document
   navigation, collapsing, source, thumbnails, and image preview remain.
4. **The main process owns the latest persisted snapshot.** Renderer snapshot
   and status acknowledgements form explicit barriers around handoff. Incomplete
   or legacy review directories are left untouched rather than silently
   migrated into the managed registry.

## Review metadata

1. **Metadata belongs to the review envelope, not the deterministic tree
   structure.** A short Markdown `contextSummary` is required. Git, pull-request,
   and agent-thread fields may be absent without blocking review creation.
2. **Explicit metadata wins.** `--branch`, `--pr`, and `--thread-id` supply
   values known by the launching agent. Provenance is stored with the values.
3. **Git discovery is best effort.** Markover uses the source directory to
   discover repository root, origin, branch, and commit. Remote URL userinfo,
   query strings, and fragments are removed before persistence.
4. **Codex discovery uses a bounded exact marker search.** A
   `mko_handoff_<high-entropy>` key can identify the launching session when the
   shell lacks its thread ID. Markover examines only a fixed number of recent
   session-log tails within a fixed byte budget. Missing, unreadable, invalid,
   substring-only, or ambiguous matches degrade to unknown metadata.
5. **Metadata stays discoverable rather than crowded into the main UI.** Tabs
   show only document, review ID suffix, and status. An information button opens
   a drawer containing the summary, paths, Git details, pull request, thread,
   and discovery provenance.

## Deliberately deferred

- Drill-down into block-quote contents or table rows and cells
- Footnote, definition-list, strikethrough, container, and other extension nodes
- Explicit warnings and selectable fallback nodes for unsupported syntax
- Annotation import, merge, or migration across document revisions
- Matching annotations across document edits
- Manual File > Open with a colocated Markover save artifact
- `markover://review/<id>` deep links
- Agent result writeback, per-annotation outcomes, and addressed state
- Organized review history, revisions, retention, and cleanup
- Automatic pull-request discovery
- Security hardening, accessibility, packaging, signing, and auto-update
- Compatibility guarantees for the tree format
