# Markover focused-preview demo storyboard

## Recording setup

- Prepare the exact clean capture commit with `npm run capture:stage`.
- Record only the sanitized capture instance and a clean terminal at 1920×1080,
  30 fps.
- Keep Ember Light selected, notifications off, and all unrelated application
  chrome out of frame.
- Export a silent H.264 MP4 between 30 and 60 seconds with burned-in captions
  and fast-start metadata.
- Use calm, descriptive language. Do not imply release guarantees or platform
  support beyond the current repository documentation.

## Timeline

### 0:00–0:07 — Open one review from the inbox

Show the prepared Inbox with **Needs me** active, then open **Launch readiness
brief** from its review row. Let the three-pane Ember Light layout establish
the selected document block and feedback pane.

Captions: **Open one review from the inbox.** then **Review agent-written
Markdown as a document tree.**

### 0:07–0:19 — Add feedback with visual context

Select the heading and reveal its feedback with the two fixture-owned images,
**workflow overview** and **annotation details**. Keep their rewritten Markdown
references visible long enough to read.

Caption: **Attach labeled visual context to one exact block.**

### 0:19–0:30 — Propose an exact source change

Select the opening paragraph and expand Source. Show the existing proposal that
narrows the rollout from everyone to the design-partner group. Hold on the real
word-level diff.

Caption: **Propose an exact edit without changing the source document.**

### 0:30–0:39 — Review every annotation together

Switch to Projects and then **All annotations**. Briefly show the four varied
annotations and their block context in the redesigned browser.

Caption: **Scan the complete review before handing it back.**

### 0:39–0:52 — Retrieve one structured handoff

Return to the terminal and run:

```sh
npm --silent run capture:cli -- get mko_capture01 \
  | jq -f doc/launch/issue-16/handoff-summary.jq
```

Show the projected status, feedback, attachment IDs and labels, and source
proposal. The capture CLI addresses only the fixture service and does not start
or inspect canonical Markover state.

Caption: **Return one structured handoff to the agent.**

### 0:52–0:56 — End card

Show the Markover lockup, **Structured review for Markdown**, and
`github.com/lastobelus/markover`.

## Pages transcript

Markover opens a sanitized launch brief in an Ember Light review inbox. The
reviewer selects one Markdown block, adds precise feedback, and keeps two
labeled images attached to that context. On the opening paragraph, Markover
shows an exact source proposal as a word-level diff without changing the source
document. The reviewer switches to All annotations to scan the complete review,
then returns to the agent's terminal. One fixture-only command retrieves a
structured handoff containing the feedback, attachment labels, and source
proposal.
