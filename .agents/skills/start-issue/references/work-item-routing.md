# Work-item routing

Use this branch only when no open issue or pull request already owns the work.
If one exists, return to the existing-item workflow in `SKILL.md`.

## Follow-up after merge

When a problem is found after a pull request merged:

1. Inspect the merged pull request, the issues it closed, and their tracker
   attachments. Treat their open attachments as the source tracker set and
   report closed Projects as historical.
2. Once the problem and proposed fix are concrete enough to describe, offer one
   choice: apply the fix now or create an issue for later. Ask one question.
   Honor a branch already chosen in the opening request without asking again.

For **apply the fix now**, reuse the source tracker set and follow the direct-PR
bootstrap below. When that set is usable, ask no tracker-choice question. When
it is empty or ambiguous, resolve tracking through the tracker-selection path
in `SKILL.md` first.

For **create an issue for later**:

1. Present the normal numbered tracker choices. Introduce them by naming the
   source tracker set, for example: `#42 was tracked in Markover Announcement
   Readiness.`
2. After selection, create an issue recording the observed problem, supporting
   evidence, proposed fix, and `Follow-up to #42`. Attach it to the selected
   tracker. Set an unambiguous Project `Todo` or backlog status when available;
   otherwise leave status unchanged.
3. Report the issue URL and tracker, then stop. The future implementation thread
   owns the work-intent claim and `In Progress` transition.

## Fresh work

Choose the smallest durable work item from discovered evidence:

- Use a direct pull request when work is authorized now, reasonably bounded to
  one pull request in one session, and needs no issue-level roadmap
  coordination.
- Use an issue when work might span multiple pull requests or sessions,
  coordinates with other roadmap issues or pull requests, or should be
  scheduled for later.

Ask one delivery-shape question only when those signals leave the choice
ambiguous. Present the normal tracker choices before the first write.

For direct-PR work, follow the bootstrap below. For issue-backed work, create
the issue in the current repository before claiming it. When scheduling it for
later, attach it, set an unambiguous Project `Todo` or backlog status when
available, report the issue and tracker, and stop. Otherwise return to stages 2
through 5 in `SKILL.md` with the issue as the target.

## Direct-PR bootstrap

After making the tracker set explicit:

1. State the action in one concise sentence. For a merged-PR follow-up, say
   `Opening a new PR linked to #42 and adding it to TRACKER_TITLE.` For fresh
   work, say `Opening one PR and adding it to TRACKER_TITLE.`
2. Scan inflight work in that tracker set before editing. Create a branch, make
   the smallest coherent first commit, and open a draft pull request. Include
   `Follow-up to #42` in the body when a merged pull request is the source.
3. Immediately attach and claim the draft pull request, then complete the
   post-claim scan before continuing implementation.

Create exactly one new work item in this path: the pull request.
