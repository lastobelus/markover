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

Markover is a macOS app for reviewing agent-written Markdown as a document tree
and returning block-level feedback to the agent thread.

> Markover is a free, MIT-licensed early preview for macOS. It requires no
> account, and review data stays on your Mac.

<p align="center">
  <img src="./docs/assets/markover-review-editor@2x.png" width="920" alt="Markover showing a document inbox, structured Markdown, and an annotation with two labeled screenshots.">
</p>

## Try the preview

Markover currently requires macOS and Node.js 22.13.0 or newer. Open a document
with the package from the current, versioned GitHub release:

```sh
npx --yes \
  --package=https://github.com/lastobelus/markover/releases/download/v0.1.1/markover-cli.tgz \
  markover open ./DOCUMENT.md \
  --summary "Explain why this document exists and what feedback would help."
```

The launcher downloads the app for the current Mac architecture on first use,
verifies its checksum, and keeps the verified app in a local cache for later
reviews. It returns a review ID and exits without waiting:

```json
{"reviewId":"mko_8f3a2c","status":"editing"}
```

> **Package-name warning:** the public npm package named `markover` is an
> unrelated Markdown-cleanup tool. Do not run `npx markover` or
> `npm install markover`; use the complete, versioned GitHub package URL above.

When the reviewer says “Check Markover,” retrieve the review once with the same
launcher and retained ID:

```sh
npx --yes \
  --package=https://github.com/lastobelus/markover/releases/download/v0.1.1/markover-cli.tgz \
  markover get mko_8f3a2c
```

`get` freezes the latest review, marks it read-only in Markover, and returns one
structured JSON handoff. If the reviewer needs to change their feedback, reopen
the same review with:

```sh
npx --yes \
  --package=https://github.com/lastobelus/markover/releases/download/v0.1.1/markover-cli.tgz \
  markover edit mko_8f3a2c
```

## Set up an agent

The generic CLI workflow is provider-neutral for agents with macOS shell
access. It is not a claim of tested integration with every agent. Copy this
instruction block into a prompt or the instruction surface your agent uses:

```md
When I ask you to open a Markdown document in Markover:

1. Run `npx --yes --package=https://github.com/lastobelus/markover/releases/download/v0.1.1/markover-cli.tgz markover open <path> --summary "<what this review is for>"` once.
2. Retain the returned `reviewId`, tell me the review is ready, and stop. Do not poll or call `get` yet.
3. When I say “Check Markover” or clearly ask you to retrieve the feedback, run `npx --yes --package=https://github.com/lastobelus/markover/releases/download/v0.1.1/markover-cli.tgz markover get <reviewId>` once.
4. Implement clear revision requests. Answer questions without silently editing. Respond to discussion points, and ask about ambiguous or conflicting feedback.
5. Treat an exact source proposal as a requested revision unless its feedback frames it as an option or question. Inspect every attachment using its label and any inline `[!label]` reference.
6. If I need to amend feedback after retrieval, run `npx --yes --package=https://github.com/lastobelus/markover/releases/download/v0.1.1/markover-cli.tgz markover edit <reviewId>`, then wait for another explicit retrieval request.
```

Codex and T3 Code use repository-root `AGENTS.md` instructions. Add this
project-scoped block; use an explicit thread ID when the current surface exposes
one, otherwise generate a new high-entropy handoff key for each review:

```md
## Markover reviews

When I ask you to open a Markdown document for review, run the versioned Markover launcher once:

`npx --yes --package=https://github.com/lastobelus/markover/releases/download/v0.1.1/markover-cli.tgz markover open <path> --summary "<what this review is for>" <thread-option>`

Set `<thread-option>` to `--thread-id <current-thread-id>` when available. Otherwise generate 16–64 random letters or digits and use `--handoff-key mko_handoff_<random-value>`.

Retain the returned `reviewId`, tell me the review is ready, and stop. Do not poll or retrieve early. When I say “Check Markover” or clearly ask for the feedback, run the same versioned launcher with `get <reviewId>` once.

Implement clear revision requests. Answer questions without silently editing. Respond to discussion points, ask about ambiguity or conflict, treat exact source proposals as requested revisions unless qualified, and inspect every labeled attachment and inline `[!label]` reference.

If I need to amend feedback, run the same launcher with `edit <reviewId>` and wait for another explicit retrieval request.
```

See the [user guide](https://lastobelus.github.io/markover/guide/) for the full
workflow, state transitions, and troubleshooting.

## Features

- Navigable, collapsible blocks for YAML frontmatter, headings, paragraphs,
  lists, tasks, code, tables, block quotes, and thematic breaks.
- Markdown feedback and labeled screenshot attachments on individual blocks.
- A durable multi-document inbox grouped by project, with an all-annotations
  browser.
- Exact source-edit proposals shown as word-level diffs without changing the
  original review target.
- One-shot agent handoff containing the exact source, checksum, document tree,
  annotations, attachments, source proposals, and review context.

## Release status

The current release supports Apple Silicon and Intel Macs. It is ad-hoc signed,
not Developer ID signed or notarized, so macOS may ask you to confirm opening an
app downloaded from the internet. See the
[user guide](https://lastobelus.github.io/markover/guide/) for current workflow
and keyboard guidance, or [development.md](./docs/development.md) for checkout,
testing, packaging, and release details.

## Community

- [Contributing](./CONTRIBUTING.md)
- [Roadmap](./ROADMAP.md)
- [Security policy](./SECURITY.md)
- [Code of conduct](./CODE_OF_CONDUCT.md)
- [Discussions](https://github.com/lastobelus/markover/discussions) for early
  ideas and questions
