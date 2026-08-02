<p align="center">
  <img src="./design/brand/markover-readme-leader.svg" width="760" alt="Markover — Structured Markdown review for agent threads.">
</p>

<p align="center">
  <a href="https://lastobelus.github.io/markover/">Website</a>
  ·
  <a href="https://lastobelus.github.io/markover/guide/">Documentation</a>
</p>

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
- Stores annotations and per-review UI state on tree nodes in durable review
  sessions.
- Accepts pasted PNG and JPEG screenshots in the feedback field. Screenshots
  become ordered node attachments, appear as thumbnails, and insert optional
  `[!img-N]` references at the cursor. Electron's native clipboard is used as a
  fallback when Preview or Finder does not expose a browser image item.
- Supports wrapping thumbnail cards, preview, removal, and whole-card
  Control-click inline label editing that updates matching image references in
  feedback.
- Copies the full annotated tree through one primary `Copy feedback JSON`
  action.
- Runs one multi-document Electron inbox for several agent threads.
- Opens reviews without blocking the launching agent, then returns frozen review
  JSON through a one-shot local command when the user says to check Markover.
- Shows reviews that are with an agent as rendered, read-only annotations while
  retaining document navigation, collapse controls, source, and image preview.
- Keeps branch, pull request, agent-thread, and context metadata in a
  discoverable drawer rather than the primary review surface.

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

## Agent review inbox

Markover can explain its complete agent protocol without launching Electron:

```sh
npm --silent run markover -- help
```

No arguments, `info`, `--help`, and `-h` return the same machine-readable help.
Invalid commands and options leave stdout empty, exit non-zero, and identify
the relevant usage plus the exact help command to run next.

Open a document for review:

```sh
npm --silent run markover -- open ./document.md \
  --summary "Explain why this document exists and what feedback would help."
```

The command starts Markover when necessary, adds a tab to the existing
single-instance inbox, prints a short opaque review ID, and exits:

```json
{"reviewId":"mko_8f3a2c","status":"editing"}
```

Keep that ID in the agent thread. After the reviewer says “Check Markover,”
retrieve the complete frozen review in one local request:

```sh
npm --silent run markover -- get mko_8f3a2c
```

`get` atomically captures the latest renderer state, changes the review to
`pending-agent`, makes its annotations read only, and emits exactly one complete
`markover-review` JSON object. Repeating `get` returns the same frozen snapshot.

If the reviewer needs to add something, return the review to editing:

```sh
npm --silent run markover -- edit mko_8f3a2c
```

Use `npm --silent`: ordinary `npm run` writes an npm banner to stdout, which
would contaminate the JSON stream an agent expects to parse.

Every review persists under:

```text
.markover/reviews/<review-id>/review.json
```

Its screenshots live under the same review directory. Restarting Markover
restores all managed reviews, including feedback, collapse state, status, and
attachments.

## Review context metadata

Pass metadata explicitly when it is known:

```sh
npm --silent run markover -- open ./document.md \
  --summary "Review the handoff model before implementation." \
  --branch feature/multi-review \
  --pr 42 \
  --thread-id 019fb49a-a321-75d3-9b10-355392949bb1
```

Markover always attempts best-effort Git discovery from the source path:
repository root, origin, branch, and commit. Explicit values win.

When the shell does not know its Codex thread ID, the launching agent can put a
unique high-entropy marker in its command:

```sh
npm --silent run markover -- open ./document.md \
  --summary "Review this plan." \
  --handoff-key mko_handoff_6f8b2c4d9a1e7035
```

Markover searches only a bounded set of recent canonical Codex log tails for
that exact marker. A unique match records the current session ID and provenance;
missing, ambiguous, unreadable, or unavailable logs do not prevent opening the
review. Discovered remote URLs have credentials, query strings, and fragments
removed before persistence.

Use the `i` button beside the document name to open the review-context drawer.
It shows the summary, source path, review status, Git metadata, pull request,
agent thread, and discovery provenance without crowding the tab strip.

## Legacy review commands

The earlier blocking command remains available while the prototype is being
compared:

```sh
npm --silent run review -- ./document.md
```

It accepts a path or piped Markdown, blocks until Done or Cancel, and writes the
review JSON directly to stdout. `review:open` and
`review:open --resume <review-id>` remain available for reopening older durable
dogfooding reviews created before the inbox workflow.

## Keyboard model

| Key | In the document pane |
| --- | --- |
| Up / Down | Move between siblings; climb outward at a boundary |
| Left | Select the parent |
| Right | Select the first child; otherwise the next available sibling |
| Tab / Shift-Tab | Move between the document and annotation panes |
| Control-Tab / Control-Shift-Tab | Move between review tabs |

Double-click a block, or click its disclosure triangle, to collapse or expand
its children.

## Feedback handoff

`markover get <review-id>` and `Copy feedback JSON` both produce the full
`markover-review` format, including the exact source, checksum, review metadata,
structure, collapse state, and block feedback. Nodes with pasted screenshots
also contain an ordered `attachments` array with image IDs, absolute paths,
MIME types, byte checksums, pixel dimensions, and optional short labels. Image
bytes are not embedded in the JSON.
