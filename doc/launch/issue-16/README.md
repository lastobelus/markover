# Public capture kit

This directory defines the sanitized source material and recording contract for
Markover's focused-preview screenshots and demo. It supports roadmap issue #16
without using a developer's real reviews, repositories, thread history, or
application state.

## Prepare the capture instance

Start from the exact clean commit that should appear in the capture receipt,
then run:

```sh
npm run capture:stage
```

The command resets only its marked directory at
`/tmp/markover-public-capture`, creates five invented reviews across three
disposable Git repositories, applies Ember Light, builds an addressed Markover
bundle, and launches it with production branding. It uses the distinct
`markover-capture` scheme, suppresses protocol registration, and never reads or
writes canonical or development review state.

Use `npm run capture:stage -- --prepare-only` when validating the fixture
without launching the app. The generated `session.json` records the exact
commit, fixture revision, theme, window size, and stable review IDs.

## Capture stills

The four replacement screenshots keep their existing names and Retina contract
so current README and Pages consumers do not need an asset migration. Arrange
these real UI states in the prepared app:

1. `markover-review-editor@2x.png` — Inbox, Needs me, primary launch brief,
   heading selected, feedback and both labeled attachments visible.
2. `markover-annotation-browser@2x.png` — Projects, All annotations, primary
   launch brief with varied feedback and attachment context.
3. `markover-source-edit@2x.png` — primary opening paragraph selected, Source
   expanded, word-level proposal visible.
4. `markover-review-context@2x.png` — primary review with Review context open,
   showing only invented project, pull request, commit, and thread metadata.

Each still is 2360×1520 at 144 dpi, captured from the app's 1180×760 logical
window at 2× scale. Keep notifications and unrelated application chrome out of
frame.

## Record the demo

Follow [demo-storyboard.md](demo-storyboard.md). Use `capture:cli` for every
agent-facing Markover command shown in the recording; it addresses only the
running capture service and refuses to start the canonical app implicitly.

```sh
npm --silent run capture:cli -- get mko_capture01 \
  | jq -f doc/launch/issue-16/handoff-summary.jq
```

Export a silent, captioned H.264 MP4 at 1920×1080, 30 fps, 30–60 seconds, with
fast-start metadata. The capture PR records the final output path and checksums;
the later media PR owns the actual screenshot and movie binaries.

## Safety checks

Before publishing any visual:

- confirm `session.json` names the intended clean commit;
- confirm Ember + Light and the 1180×760 logical window;
- scan every visible path, repository, pull request, review ID, thread ID, and
  machine label against `capture-manifest.json`;
- inspect the four stills and every movie frame for notifications, private
  paths, credentials, authorization material, or unrelated application chrome;
- run the deterministic checks documented by the media PR before upload.

The marker file is the deletion boundary. The staging command refuses to
replace an unmarked directory, a symlink, or a fixture whose capture service is
still running.
