# Issue 16 launch-production bundle

This directory contains editable sources for Markover's focused-preview launch
assets. Public copy must stay simple, clear, descriptive, calm, and free of
glazing or large unsupported claims.

## Preparation assets

| Source | Purpose | Published output |
| --- | --- | --- |
| `launch-manifest.json` | Desired repository metadata, profile pins, release gate, and asset hashes | Live GitHub settings after finalization |
| `github-social-preview.svg` | Editable 1280×640 GitHub card | `docs/assets/markover-github-social-preview.png` |
| `pages-social-card.svg` | Editable 1200×630 Pages card | `docs/assets/markover-pages-social-card.png` |
| `launch-brief.md` | Purpose-built document reviewed in the demo | Demo only |
| `handoff-summary.jq` | Readable projection of real handoff fields | Demo only |
| `demo-storyboard.md` | Recording steps, captions, and transcript source | Final MP4 and Pages transcript |
| `reddit-draft.md` | Ready-to-finalize r/codex copy | Posted by issue 17 |

Build the raster cards on macOS with:

```sh
npm run build:social-cards
```

The build reads the canonical `design/brand/markover-lockup.svg`, embeds it in a
temporary rendering source, and verifies the PNG dimensions and GitHub file-size
limit. `test/launch-assets.test.js` verifies the committed source and output
hashes against the manifest.

## Finalization gate

Do not publish `reddit-draft.md` or copy its placeholders to a public surface.
After issues 10 and 11 identify and verify the exact prerelease:

1. Set `release.focusedPreviewTag` in the manifest and update every public
   launcher URL to that exact tag.
2. Capture the current public landing-page hero as
   `current-landing-page.png` for the demo fixture.
3. Run the generic CLI lifecycle and the Codex/T3 Code `AGENTS.md` workflow end
   to end, then record the evidence.
4. Record and export the final MP4, poster, and transcript from the verified
   prerelease.
5. Resolve `[PREVIEW_TAG]` and `[DEMO_URL]`, deploy Pages, and verify public link
   previews.
6. Apply the repository settings and profile pins from the manifest only after
   the matching default-branch assets are live.

Issue 16 remains open until those steps have final-state evidence. Issue 17 owns
posting to r/codex and operating the feedback round.
