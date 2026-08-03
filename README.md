<p align="center">
  <img src="./design/brand/markover-readme-leader.svg" width="760" alt="Markover — Structured review for Markdown.">
</p>

<p align="center">
  <a href="https://lastobelus.github.io/markover/">Website</a>
  ·
  <a href="https://lastobelus.github.io/markover/guide/">User guide</a>
  ·
  <a href="./docs/development.md">Development</a>
</p>

Markover is a macOS app for reviewing Markdown as a document tree and returning
block-level feedback to an agent.

<p align="center">
  <img src="./docs/assets/markover-review-editor@2x.png" width="920" alt="Markover showing a document inbox, structured Markdown, and an annotation with labeled screenshots.">
</p>

<p align="center">
  <img src="./docs/assets/markover-annotation-browser@2x.png" width="920" alt="Markover showing every rendered annotation in the active document.">
</p>

## Features

- Navigable, collapsible blocks for YAML frontmatter, headings, paragraphs,
  lists, tasks, code, tables, block quotes, and thematic breaks.
- Markdown feedback and labeled screenshot attachments on individual blocks.
- A durable multi-document inbox grouped by project, with an all-annotations
  browser.
- Exact source-edit proposals shown as word-level diffs without changing the
  original review target.
- One-shot agent handoff containing the exact source, checksum, document tree,
  annotations, attachments, and review context.

## Try without installing

Markover currently requires macOS and Node.js 22.13.0 or newer. Open a document with:

```sh
npx --yes \
  --package=https://github.com/lastobelus/markover/releases/latest/download/markover-cli.tgz \
  markover open ./DOCUMENT.md \
  --summary "Explain why this document exists and what feedback would help."
```

The command downloads the app for the current Mac architecture on first use,
verifies its checksum, and reuses the cached app afterward. It returns a review
ID and exits without waiting for the review:

```json
{"reviewId":"mko_8f3a2c","status":"editing"}
```

If you are an agent, retain the returned `reviewId` and stop. When the user says “Check
Markover,” run the same launcher with `get <reviewId>`:

```sh
npx --yes \
  --package=https://github.com/lastobelus/markover/releases/latest/download/markover-cli.tgz \
  markover get mko_8f3a2c
```

If the reviewer needs to change their feedback after handoff, use `edit` with
the same review ID.

The current release is ad-hoc signed rather than Developer ID signed and
notarized. See the [user guide](https://lastobelus.github.io/markover/guide/)
for the review workflow and keyboard controls, or
[development.md](./docs/development.md) for checkout, testing, packaging, and
release notes.
