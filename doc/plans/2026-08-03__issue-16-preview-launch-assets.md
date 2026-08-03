# Issue 16: focused-preview repository metadata and launch assets

## Outcome

Prepare one candid, coherent launch kit for Markover's focused preview. Every
public link used by the preview must identify Markover clearly, explain the
human-to-agent review workflow accurately, and lead a macOS Codex user to one
tested prerelease without unsupported claims.

Issue 16 prepares and verifies the kit. Issue 17 owns recruiting the initial
testers, publishing the r/codex post, responding during the announcement
window, and triaging resulting feedback. Broad-announcement venue copy remains
out of scope until issue 18.

## Audience and positioning

- Optimize for macOS users who already use coding agents to produce substantial
  Markdown, with Codex and T3 Code as the verified initial fit.
- Lead with the problem: chat flattens structured review, making it difficult to
  attach notes to exact blocks, organize and reference labeled screenshots,
  combine proposed edits with questions, and revisit notes in the context of
  the original document.
- Describe the workflow as reviewing agent-written Markdown block by block and
  returning a structured handoff. Do not position Markover as a general
  Markdown editor, collaboration service, or live discussion system.
- Keep **“Structured review for Markdown.”** as the sole canonical descriptor.
  Use “local-first” judiciously as a factual attribute, always clarified as no
  account and review data staying on the user's Mac.

## Repository and profile metadata

Record the desired settings in a versioned launch manifest, then apply them only
after the matching public assets are live on the default branch.

- Description: `Local-first macOS app for reviewing agent-produced Markdown and returning structured, block-level feedback to the agent thread.`
- Homepage: `https://lastobelus.github.io/markover/`
- Topics: `markdown`, `document-review`, `annotations`, `ai-agents`,
  `coding-agents`, `codex`, `local-first`, `macos`, `electron`, and
  `developer-tools`.
- Profile pins: Markover first and `lastCode` second.
- GitHub social preview: one warm-palette 1280×640 card with the Markover lockup
  and canonical descriptor; no UI screenshot.
- Pages social preview: a matching 1200×630 Open Graph card with complete Open
  Graph and large-card metadata.

Commit editable SVG sources beside deterministic PNG exports. Extend the
existing macOS-native asset-build approach rather than adding an image-processing
dependency. Local tests must verify sources, output dimensions, file sizes,
metadata references, and manifest consistency; live GitHub state is verified at
issue closure rather than mutated by a permanent repository script.

## Canonical product image

Use `docs/assets/markover-review-editor@2x.png` as the canonical product
screenshot. Show it once inline in the README, use it for the linked demo
thumbnail and full-frame 16:9 demo poster, and retain it as the first image in
the Pages gallery. Keep the other three screenshots in the Pages gallery rather
than stacking them in the README.

Retain the current screenshot unless the tested prerelease materially changes a
visible workflow or interface. If it does, recapture once and update every use
together.

## Demo

Publish an approximately 45-second, silent 1920×1080, 30 fps H.264 MP4 with
burned-in captions, deliberate cursor movement, clean cuts, gentle zooms, and
web fast-start metadata. The Pages embed must use a warm 16:9 poster based on the
complete canonical screenshot, visible controls, inline playback,
`preload="metadata"`, no autoplay, and a text transcript. Reddit receives a
native upload and uses the same thumbnail when the venue permits it.

The demo begins and ends in one clean agent thread, following one real review ID
and one purpose-built `launch-brief.md`:

1. Ask the agent to open `launch-brief.md` for review. Show it run the exact
   pinned prerelease command, retain the returned review ID, and stop while the
   human reviews.
2. Select a block, paste a fresh screenshot of the public Markover landing-page
   hero, and relabel it `current landing page`. Keep the automatically rewritten
   `[!current landing page]` reference visible inside a genuine question about
   leading with the block-level workflow.
3. On a different block, replace an overbroad every-agent compatibility claim
   with the honest boundary: provider-neutral for shell-capable agents and
   verified with Codex and T3 Code. Show the real word-level source diff.
4. Return to the same agent thread and type “Check Markover.” Show the agent use
   the retained ID to invoke `markover get <review-id>`, briefly show the app
   become read-only/with-agent, then display a `handoff-summary.jq` projection
   containing only real handoff fields: `review.status`, feedback, attachment
   `id` and `label`, and `sourceEdit.original`/`current`.
5. End for two seconds on the Markover lockup, “Free, MIT-licensed early preview
   for macOS,” and the repository URL.

Record from the exact prerelease that passes issues 10 and 11, in a clean
purpose-built workspace with notifications disabled and no private paths,
documents, review history, or thread metadata. Commit the optimized MP4, not a
large recording master or editor project.

Store the storyboard, commands, captions, transcript, `launch-brief.md`, public
landing-page attachment, and `handoff-summary.jq` under
`doc/launch/issue-16/`. Store only browser-consumed outputs under
`docs/assets/`.

## README and guide

Reorder the README as purpose, preview disclosure, demo/screenshot, copyable
quick start, then detailed features and community information. Place the Pages
video directly below the existing hero and above the feature grid. The README
uses the canonical screenshot as a linked “Watch the 45-second demo” thumbnail
instead of attempting an inline video.

All public language must be simple, clear, descriptive, and calm. No glazing,
superlatives, breathless launch language, or large unsupported claims. Describe
the problem concretely, state only behavior verified in the corresponding
release, and let the workflow demonstrate the product's value.

Use this baseline disclosure on long-form launch surfaces:

> Markover is a free, MIT-licensed early preview for macOS. It requires no
> account, and review data stays on your Mac.

Keep the ad-hoc-signing/notarization warning beside installation instructions.
State macOS and Node.js 22.13.0 or newer before the first command. Rename “Try
without installing” to “Try the preview” and explain that the launcher downloads,
verifies, and caches the matching app. Warn that the public npm package named
`markover` is unrelated and must not be installed or invoked; every copyable
block uses the full package URL pinned to the exact prerelease tag. No unresolved
release placeholder may appear on a public page.

Provide two self-contained setup blocks inline:

- A provider-neutral template for agents with macOS shell access, without
  claiming named compatibility.
- A verified repository-root `AGENTS.md` snippet for Codex and T3 Code. It uses
  an explicit `--thread-id` when available or a fresh high-entropy
  `mko_handoff_…` key otherwise.

Both teach the full lifecycle: open once, retain the review ID, stop, wait for
the reviewer to say “Check Markover” or an obvious equivalent, call `get` once,
and use `edit` if the reviewer needs to amend feedback. After retrieval, agents
implement clear revision requests, answer questions without silently editing,
respond to discussion points, ask about ambiguity or conflict, treat exact
source proposals as requested revisions unless qualified, and inspect every
attachment using edited labels and inline references. The guide expands these
rules with troubleshooting and links to issue 9's canonical privacy, storage,
deletion, support, limitations, and compatibility documentation.

## Focused-preview announcement copy

Commit a ready-to-post r/codex draft under `doc/launch/issue-16/` with this title:

> I built a little Electron app for reviewing agent-written Markdown block by block

Use a candid first-person maintainer voice in approximately 300–450 words and
follow the same simple, clear, descriptive, calm, no-glazing tone rule as the
README and guide. Open with the structured-review problem, let the native demo
explain the mechanics, link primarily to the GitHub repository and secondarily
to Pages, and include the free/MIT/macOS/early-preview/local-data disclosure
plus the ad-hoc-signing warning. Ask readers to run one real Markdown review and
report the first confusing or broken step; do not request stars or upvotes.
Keep lightweight feedback in the Reddit thread and direct reproducible failures
to the structured GitHub bug form.

Recheck r/codex's current project-promotion rules immediately before issue 17
posts. Resolve the exact prerelease tag and demo URL before issue 16 closes.

## Delivery checkpoints

### 1. Preparation

- Add the launch manifest, card sources and exports, demo fixtures, storyboard,
  transcript source, filtered-output fixture, r/codex draft, and local checks.
- Restructure README/guide and Pages code only where the result is complete and
  accurate with the currently published release. Keep unresolved preview values
  confined to non-public production material.
- Run the full repository check and test suites, inspect the built Pages site,
  and commit the completed slice after review findings are addressed.

### 2. Preview finalization

- Substitute the exact immutable prerelease tag produced by issue 10 and verify
  published Apple Silicon and Intel artifacts through issue 11.
- Run the generic CLI lifecycle and a fresh Codex/T3 Code `AGENTS.md` workflow
  end to end. Record surface/version, tag, date, and results.
- Record and export the final demo, publish the Pages embed/transcript, resolve
  all launch-copy links, capture the fresh public landing-page attachment, and
  rerun local and deployed checks.
- After the default branch and Pages deployment are live, set and verify GitHub
  description, homepage, topics, social preview, and profile-pin order.

Issue 16 remains open between checkpoints. It closes only when every public
placeholder is resolved and every acceptance criterion has final-state evidence.

## Verification and closure evidence

- Run `npm run check`, `npm test`, targeted asset/metadata tests, and
  `git diff --check` for each implementation checkpoint.
- Verify Pages in Safari and Chromium at desktop and narrow widths, including
  video controls, poster, transcript, screenshot gallery, and social metadata.
  Repeat against the deployed Pages URL after merge.
- Verify GitHub repository metadata, social preview, profile pin order, README
  links, Pages preview, pinned launcher URL, release assets, and bug-form route.
- Add an issue-16 closure comment mapping concrete links, commands, test results,
  and screenshots to every original acceptance criterion. Keep the issue body
  unchanged; this plan owns the detailed requirements.

## Explicitly out of scope

- Publishing the r/codex post or operating the feedback round (issue 17).
- Broad-launch copy or additional announcement venues (issue 18).
- Replacing issue 9's canonical policy and limitation documentation.
- Claiming verification for Claude Code, Gemini CLI, Cursor, or other named
  agents.
- Adding a hosted service, account system, telemetry, live discussion, or
  automatic intent-classification claim.
