# Markover

Markover is a deliberately small Electron prototype for reviewing Markdown as a
tree and attaching feedback to individual blocks.

## Prototype scope

- Parses headings, ordered-list items, unordered-list items, and fenced code
  blocks into a deterministic tree.
- Keeps the exact Markdown source and a SHA-256 checksum in the tree.
- Collapses and expands any block with children.
- Navigates blocks with the arrow keys.
- Switches between the document and annotation panes with Tab or Shift-Tab.
- Stores annotations on tree nodes in memory.
- Copies concise Markdown feedback or the full annotated tree as JSON.

Paragraphs and other Markdown constructs are counted as omitted source lines.
The source itself is always retained, so the checksum still represents the
complete input document.

## Run

```sh
npm install
npm start
```

Run the focused parser and navigation tests with:

```sh
npm test
```

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

`Copy feedback` produces readable Markdown containing only annotated blocks,
their source ranges, their original source, and the document checksum.

`Copy tree JSON` produces the full format, including exact source, checksum,
structure, collapse state, and annotations.
