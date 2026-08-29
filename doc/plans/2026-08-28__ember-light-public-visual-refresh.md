# Ember Light public visual refresh

## Status and truth context

This is the implementation plan for the public visual refresh requested after
[PR #195](https://github.com/lastobelus/markover/pull/195), which merged the
current Markover application redesign on August 28, 2026. The plan coordinates
one umbrella pull request and a short stack of independently reviewable child
pull requests.

The work directly takes over the visual and media portions of
[issue #16](https://github.com/lastobelus/markover/issues/16). It supersedes the
conflicted, pre-redesign draft [PR #51](https://github.com/lastobelus/markover/pull/51)
while preserving that draft's useful launch manifest, social-card generator,
storyboard, transcript, and validation ideas.

[Issue #84](https://github.com/lastobelus/markover/issues/84) remains a late
Broad-announcement editorial pass. This stack will refresh its screenshot,
link, command, and responsive-layout prerequisites, but will not claim that the
post-feedback human editorial review has happened.

## Outcome

Every current public or undated visual representation of Markover matches the
application delivered by #195 and presents the Ember Light theme consistently.
The repository gains a reproducible, privacy-safe way to stage the app for
media capture, four current product screenshots, one 30–60 second product demo,
updated GitHub Pages and README presentation, and a verified set of repository
metadata and social-preview assets.

The work is complete when a prospective user sees the same product structure,
theme, and workflow in the README, Pages site, screenshots, demo, social cards,
and live GitHub repository metadata.

## Current gap

- The four tracked product screenshots are unchanged since August 2. They show
  the retired document-tab strip, visible checksum, old header geometry, old
  review navigation, and pre-#195 pane colors.
- The README embeds the first two stale screenshots. The Pages gallery embeds
  all four.
- The Pages site still uses the older public warm palette and Inter typography,
  and its hand-built hero mock shows the old two-pane product structure.
- `design/brand/markover-readme-leader.svg` still uses the older muted ink and
  typography stack.
- The repository has no tracked movie, no media-capture fixture, and no
  repeatable staging workflow.
- GitHub currently has no homepage or topics and uses a generic social card.
- Draft PR #51 contains useful launch preparation, but it predates #195 and
  conflicts with current `main`.

## Public visual contract

The public visual system follows the current Ember Light application rather
than inventing a separate marketing palette:

| Role | Current Ember Light value or source |
| --- | --- |
| Typography | SF/system stack used by the app |
| App shell / page ground | `#e8e2d8` |
| Document paper | `#f7f4ee` |
| Quiet pane surface | `#ece9e2` |
| Primary text | `#26211e` |
| Muted text | `#6f6761` |
| Primary brand | `#c94e1f` |
| Secondary brand | `#6d211f` |
| Code surface | `#262b2b` |

The Pages site may map these roles to web-specific component tokens, but the
rendered hierarchy must remain recognizably the same: App header above a
three-pane layout, neutral left and right panes around a paper center pane,
restrained Ember accents, and the current typography and spacing character.

## Delivery shape

The umbrella pull request remains a draft coordination and aggregate-review
surface until the child stack lands into it. Each child is reviewed against the
branch immediately below it; after a child merges downward, the next child is
retargeted to the umbrella branch. The completed umbrella is merged to `main`
last.

| Order | Pull request | Base branch | Purpose |
| --- | --- | --- | --- |
| 0 | Umbrella PR | `main` | This plan, inventory, capture contract, child checklist, and aggregate review |
| 1 | Capture foundation | umbrella branch | Sanitized fixture, public-brand isolated staging, manifest/storyboard salvage, and deterministic media checks |
| 2 | Ember Light public theme | capture-foundation branch | Pages theme, three-pane hero mock, README leader/banner, current brand board, social-card sources, and tests |
| 3 | Current screenshots | public-theme branch | Four computer-captured Retina screenshots and updated README/gallery descriptions |
| 4 | Demo and launch assets | screenshot branch | 30–60 second movie, poster, transcript, Pages embed, README link, final social cards, and live repository metadata checklist |

This is a real stack because each later slice consumes visual decisions or
capture state established below it. Work that does not depend on this stack
stays in an ordinary pull request.

## Slice 1 — Capture foundation

### Goal

One command creates a disposable, sanitized, public-branded Markover state that
can be driven through the real UI without touching canonical reviews or showing
development badges.

### Work

- Salvage the useful fixture, launch manifest, storyboard, transcript, filtered
  handoff, social-card generation, and validation concepts from PR #51. Rebuild
  them on current `main`; do not rebase the stale PR wholesale.
- Add the smallest capture-only staging script needed to create a disposable
  state root, seed representative reviews and metadata, launch the built app
  with public branding, and suppress protocol-registration side effects.
- Keep staging deterministic and sanitized: invented project, repository,
  branch, pull-request, thread, review, document, attachment, and path values;
  no user review history, home-directory paths, real thread IDs, notifications,
  or network-fetched content.
- Record the exact app commit, fixture revision, window size, theme, appearance,
  and asset outputs in a versioned capture manifest.
- Keep computer use responsible for arranging final UI states and taking the
  captures. The fixture prepares truth; it does not fake rendered screenshots.

### Done when

- A fresh run produces the same representative review set in isolated storage.
- The launched window uses production branding and current product behavior.
- Canonical and development-instance review stores remain untouched.
- A maintainer can reset and recreate the capture state without manual data
  entry.
- Focused tests cover fixture sanitization, launch isolation, and manifest
  validity.

## Slice 2 — Ember Light public theme

### Goal

The public site, README leader, social cards, and undated brand references use
the visual language of #195 before current product media is dropped into them.

### Work

- Update `docs/user/styles.css` and every repeated public `theme-color` value to
  the Ember Light role mapping.
- Rebuild the landing-page hero mock as the current App header plus Left,
  Center, and Right panes. Preserve it as responsive HTML/CSS rather than a
  baked image.
- Update the README leader/banner typography and muted color while preserving
  the canonical mark and logotype geometry.
- Rebuild the GitHub 1280×640 social preview and Pages 1200×630 Open Graph card
  from deterministic, editable sources.
- Add complete Open Graph and large-card metadata to every public page that
  needs a share preview.
- Refresh the undated brand usage board and the reachable static inbox visual
  fixture where they claim to show the current product. Keep dated design
  explorations as historical records.
- Update useful semantic tests without locking the site to incidental prose.

### Done when

- The Pages home and documentation layouts are coherent at desktop and narrow
  widths and visibly match Ember Light.
- The hero depicts the current three-pane structure and no retired tab strip or
  checksum.
- Banner and social-card sources and exports pass dimension, size, reference,
  and hash checks.
- Current undated visual references no longer depict the retired application.

## Slice 3 — Current screenshots

### Goal

Replace the four stale product screenshots with real current-app captures while
preserving their useful semantic coverage and stable consumer paths.

### Capture protocol

Before launching or focusing Markover, read the machine interaction policy.
Run the isolated capture state from the exact committed foundation, choose
Ember + Light explicitly, use an 1180×760 point window on a Retina display, and
capture 2360×1520 RGB PNGs with 144-dpi metadata. Disable notifications and
inspect every frame for private or accidental content.

Use computer control to stage each state in the current UI, then use native
screen capture. Do not composite, regenerate, or AI-edit product UI pixels.

### Capture matrix

| Existing filename | State to capture |
| --- | --- |
| `markover-review-editor@2x.png` | Inbox, Needs me, several project/review rows, selected heading, populated feedback, and two labeled attachments; canonical strongest image |
| `markover-annotation-browser@2x.png` | Projects navigation, All annotations, and several varied rendered annotations with attachment context |
| `markover-source-edit@2x.png` | Selected paragraph, expanded Source card, and the current stacked word-level source proposal |
| `markover-review-context@2x.png` | Current Review context surface with sanitized review, Git, pull-request, and agent/thread metadata |

### Done when

- All four files come from the recorded current commit and show #195's App
  header and three-pane structure in Ember Light.
- Filenames, 2360×1520 dimensions, and 144-dpi density remain stable unless
  visual review proves a contract change is worthwhile.
- README and gallery alternative text and captions describe what is actually
  visible.
- The canonical screenshot appears once in the README; the gallery retains all
  four states.
- Human QA confirms visual fidelity, legibility, privacy, cropping, and absence
  of development-only UI.

## Slice 4 — Demo and launch assets

### Goal

Show the real end-to-end review loop in one concise movie and finish issue
#16's current visual and repository-metadata deliverables.

### Movie

Record a silent 30–60 second, 1920×1080, 30 fps H.264 MP4 with fast-start
metadata, burned-in captions, deliberate cursor movement, and no private
content. Use the staged fixture and one review ID throughout:

1. An agent opens a Markdown brief and stops.
2. The reviewer selects a block, writes precise feedback, and shows a labeled
   screenshot attachment.
3. The reviewer proposes an exact source edit and shows the word-level diff.
4. The reviewer checks All annotations.
5. The agent retrieves the structured handoff using the retained review ID.
6. A short end card identifies the free MIT-licensed macOS early preview and
   repository URL.

Commit the optimized MP4, poster, transcript, captions, fixture document, and
filtered handoff example. Keep recording masters and editor projects outside
the repository. The Pages site embeds the movie with visible controls,
`preload="metadata"`, no autoplay, a poster, and a text transcript. The README
links its poster to the hosted demo rather than embedding a large animation.

### Live repository metadata

After the matching default-branch assets and Pages deployment are live, use
browser/computer control to apply and verify:

- repository description;
- Pages homepage URL;
- selected topics;
- custom GitHub social preview;
- maintainer profile pin order.

Record the intended and observed values in the launch manifest. External
metadata is not considered complete merely because a source asset exists in
the repository.

### Done when

- `ffprobe` confirms H.264, 1920×1080, 30 fps, 30–60 seconds, no audio, and
  fast-start playback.
- Pages desktop and narrow layouts expose usable video controls, poster,
  transcript, gallery, and share metadata.
- README light and dark GitHub rendering is legible and uses the strongest
  current image consistently.
- The deployed Pages URL, repository settings, social preview, and profile pins
  match the manifest.
- Issue #16 has closure evidence for every acceptance criterion that this stack
  owns. Posting and operating the announcement remain with issue #17.

## Roadmap integration

| Item | Treatment |
| --- | --- |
| #16 | Directly owned by this umbrella; close only after final assets and live metadata are verified |
| #51 | Superseded after the umbrella exists; salvage selected preparation rather than stale UI outputs |
| #84 | Keep open; this stack supplies current screenshots, commands, links, and responsive visual prerequisites for its later human editorial pass |
| #5 | Parent launch gate; update with #16 progress but do not close from this work |
| #17 | Downstream focused-preview posting and feedback operation; consumes assets but stays out of scope |
| #18 | Downstream broad-announcement work; stays out of scope |
| #13 and #80 | Preserve truthful signing/notarization and Intel-support boundaries in refreshed copy; do not absorb implementation |
| #181 | Product modal redesign remains separate unless a selected public capture later requires that modal |

No other open roadmap issue directly owns screenshots, movies, banners,
branding, GitHub Pages presentation, tutorials, or onboarding.

## Verification

Every child PR runs the narrow checks for its surface plus `git diff --check`.
Before the umbrella merges:

- run `npm run ci:local` on the aggregate head;
- verify the ELI5 and documentation site build;
- verify all local links and asset references;
- inspect screenshot dimensions, density, and privacy;
- inspect social-card dimensions, hashes, and GitHub's under-1-MB limit;
- inspect movie codec, dimensions, frame rate, duration, audio absence, and
  fast-start metadata;
- use the collaborative browser to check Pages at desktop and narrow widths;
- use native computer control for the current Markover capture states;
- perform human QA of README light/dark rendering, Pages presentation, all
  captures, movie pacing/captions, and live external metadata.

The final media is pinned to the recorded app commit. A later UI change makes
recapture a new decision rather than silently invalidating this stack's finite
completion evidence.

## Boundaries

- Do not change application behavior merely to make a prettier capture.
- Do not add a general fixture framework, screenshot service, recording daemon,
  background process, or compatibility path.
- Do not touch canonical review data or capture real private metadata.
- Do not use AI-generated or edited pixels as evidence of the application UI.
- Do not rewrite dated historical design artifacts that are clearly labelled
  by date and no longer claim to be current.
- Do not publish announcement posts or operate their feedback rounds.
- Do not claim #84 complete before its late, post-feedback human editorial pass.
- Do not fold #181 or unrelated product UI refinements into public-collateral
  work.

## Completion

The umbrella PR can leave draft status only when all four child slices have
landed into it, aggregate validation passes, current media has accepted human
QA, issue #16's live repository settings are verified, and every remaining
roadmap item above has an explicit handoff rather than an implied closure.
