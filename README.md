# Markover

Markover is a deliberately small Electron prototype for reviewing Markdown as a
tree and attaching feedback to individual blocks.

## Prototype scope

- Uses markdown-it's CommonMark preset to parse paragraphs, headings, ordered
  and unordered list items, thematic breaks, and code blocks into a
  deterministic tree.
- Treats each block quote and table as one opaque selectable node. Embedded
  quote blocks and table rows or cells render but are not navigation targets.
- Recognizes leading `[ ]`, `[x]`, and `[X]` markers as simple task state on
  ordinary list-item nodes.
- Preserves hard-wrapped list content and renders inline emphasis, strong text,
  code, and inert links and images whose paths appear on hover.
- Keeps the exact Markdown source and a SHA-256 checksum in the tree.
- Collapses and expands any block with children.
- Shows aligned indicators for the block's own annotation, descendant
  annotations, and images anywhere in its subtree.
- Identifies the selected node by type and line span; list items also show their
  position within the list.
- Pins a mirror of the selected block when its original row scrolls above the
  document viewport.
- Uses compact, aligned pane headers with a four-pixel top focus indicator and
  full-bleed square hover/selection bands that cover the scrollbar.
- Shows the selected block's exact raw Markdown in a compact, collapsible,
  horizontally scrolling source panel.
- Navigates blocks with the arrow keys.
- Switches between the document and annotation panes with Tab or Shift-Tab.
- Stores annotations on tree nodes in memory.
- Accepts pasted PNG and JPEG screenshots in the feedback field. Screenshots
  become ordered node attachments, appear as thumbnails, and insert optional
  `[!img-N]` references at the cursor. Electron's native clipboard is used as a
  fallback when Preview or Finder does not expose a browser image item.
- Supports wrapping thumbnail cards, preview, removal, and whole-card
  Control-click inline label editing that updates matching image references in
  feedback.
- Copies the full annotated tree through one primary `Copy feedback JSON`
  action.
- Runs as a blocking agent review command that emits JSON when the reviewer
  clicks Done.

Unsupported Markdown extensions currently degrade according to CommonMark:
their syntax can appear literally in paragraph nodes, resolve as ordinary
reference syntax, or remain only in the retained source. The
[`examples/block-types.md`](examples/block-types.md) sampler contains both
supported nodes and deliberately unsupported footnote, definition-list,
strikethrough, and raw-HTML cases for iterating on this behavior. The exact
source is always retained, so the checksum represents the complete input.

## Run

```sh
npm install
npm start
```

Run the focused parser and navigation tests with:

```sh
npm test
```

## Agent review command

Pass a path:

```sh
npm --silent run review -- ./document.md
```

Or pipe Markdown:

```sh
cat ./document.md | npm --silent run review
```

Override the gitignored `.markover/attachments/` screenshot directory:

```sh
npm --silent run review -- ./document.md --attachments-dir ./tmp/review-images
```

The command opens Markover and blocks. Clicking **Done** writes exactly one
`markover-review` JSON object to stdout and exits with code 0. Clicking
**Cancel**, closing the window, or providing invalid input exits non-zero
without writing JSON.

Use `npm --silent`: ordinary `npm run` writes an npm banner to stdout, which
would contaminate the JSON stream an agent expects to parse.

The emitted object stores the exact input under `sourceDocument.content`, its
SHA-256 value under `sourceDocument.checksum`, the absolute source path when a
path was supplied, and reviewer comments in each block's `feedback` field.

## Durable dogfooding reviews

Open a review independently of the terminal or agent process:

```sh
npm --silent run review:open -- ./document.md
```

This returns a review ID and autosave path, then exits while the Electron
window continues under the user's macOS `launchd` domain. Every feedback,
collapse, attachment, removal, and attachment-label change atomically updates:

```text
.markover/reviews/<review-id>/review.json
```

If Electron closes unexpectedly, resume the same saved tree:

```sh
npm --silent run review:open -- --resume <review-id>
```

Durable reviews expose `Copy feedback JSON` rather than a blocking Done action.
The original blocking `review` command remains available for the current
agent-waits-for-user handoff experiment.

## Keyboard model

| Key | In the document pane |
| --- | --- |
| Up / Down | Move between siblings; climb outward at a boundary |
| Left | Select the parent |
| Right | Select the first child; otherwise the next available sibling |
| Tab / Shift-Tab | Move between the document and annotation panes |

Double-click a block, or click its disclosure triangle, to collapse or expand
its children.

## Feedback handoff

`Copy feedback JSON` produces the full `markover-review` format, including the
source document metadata, structure, collapse state, and block feedback.
Nodes with pasted screenshots also contain an ordered `attachments` array with
image IDs, absolute paths, MIME types, byte checksums, pixel dimensions, and
optional short labels. Image bytes are not embedded in the JSON.
