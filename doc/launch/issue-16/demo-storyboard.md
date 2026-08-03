# Markover focused-preview demo storyboard

## Production status

This is the preparation storyboard. Replace `<PREVIEW_TAG>` and `<REVIEW_ID>`
only after issues 10 and 11 identify and verify the exact prerelease. Record the
final video from that build.

## Recording setup

- 1920×1080 at 30 fps, exported as silent H.264 MP4 with fast-start metadata.
- Clean Codex or T3 Code thread, clean Markover review history, and notifications
  disabled.
- Only `launch-brief.md`, the public landing-page screenshot, and the filtered
  handoff appear.
- Public copy and captions stay simple, clear, descriptive, calm, and free of
  glazing or large claims.

## Timeline

### 0:00–0:07 — Open from the agent thread

Prompt the agent:

> Open `doc/launch/issue-16/launch-brief.md` in Markover for review.

Show the agent run the exact command for `<PREVIEW_TAG>`, retain `<REVIEW_ID>`,
and stop. Caption: **Open an agent-written Markdown document.**

### 0:07–0:20 — Ask a screenshot-backed question

In Markover, select the paragraph under **Landing page**. Type “Could we lead
with the block-level review workflow shown in ”, paste
`current-landing-page.png`, and relabel it `current landing page`. Keep the
rewritten `[!current landing page]` reference visible. Caption: **Attach a
question and label its visual context.**

### 0:20–0:31 — Propose an exact source change

Select “Markover works with every coding agent.” and propose:

> Markover is provider-neutral for agents with macOS shell access and verified
> with Codex and T3 Code.

Show the real word-level diff. Caption: **Propose an exact edit without changing
the review target.**

### 0:31–0:43 — Check Markover in the same thread

Return to the agent thread and type:

> Check Markover.

Show the agent invoke `get` with the retained review ID. Briefly show Markover
become read-only/with-agent, then show the real response projected through
`handoff-summary.jq`: review status, question, attachment ID and edited label,
and original/current source proposal. Caption: **Return one structured handoff
to the agent thread.**

### 0:43–0:45 — End card

Show the Markover lockup, **Free, MIT-licensed early preview for macOS**, and
`github.com/lastobelus/markover`.

## Pages transcript

An agent opens a Markdown launch brief in Markover and waits. The reviewer asks
a question on one exact block, pastes a screenshot, and changes its label to
“current landing page.” On another block, the reviewer proposes an exact source
change, which Markover shows as a word-level diff while preserving the original
document. Back in the same agent thread, the reviewer says “Check Markover.” The
agent retrieves one structured handoff containing the question, labeled
attachment, and source proposal, and Markover marks the review read-only.
