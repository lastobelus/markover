# Skills rewrite thread

This is the thrust retained by the existing thread. Read `README.md` first.

## Collaboration model

Opus writes agent-facing prose, structure, and voice. Codex supplies evidence
and performs a surgical correctness review. The user prefers Opus's clarity and
finds Codex prose more likely to invite opaque machinery. Preserve Opus's voice;
do not turn an editor pass into another rewrite.

The copied skills and discussion files are intentional temporary working
copies. Do not report their duplicate names as a defect. Keep discussion files
until a rewrite is promoted so a second attempt can refer to the exchange.

## Babysit: complete

The Opus rewrite was promoted by PR #153 (`a46ab164`) and amended while PR
#154 landed (`d00d5e96`). The canonical source is now
`origin/main:.agents/skills/babysit/`. This archive worktree predates both
merges, so its tracked `.agents/skills/babysit/` is the old skill.

The retained `babysit-rewrite` directory is the historical working copy the
user asked to keep. It is useful evidence, not a promotion source, and it is
not byte-identical to main. In particular:

- main reads and sorts the complete finding set before applying the tripwire;
  the retained copy applies it before that read;
- main's merge reference correctly says five verbs; the retained copy still
  says four after `fold` was added; and
- main completes a merged pull request's claim only when one exists; the
  retained copy assumes every merged pull request carries one.

Start future babysit edits from a branch rooted at current main. Keep the
retained copy and its discussions unchanged as reference rather than promoting
it wholesale. Its files are:

- `.agents/skills/babysit-rewrite/SKILL.md`
- `.agents/skills/babysit-rewrite/references/merge.md`
- `.agents/skills/babysit-rewrite/discussion-01-codex.md`
- `.agents/skills/babysit-rewrite/discussion-02-opus.md`
- `.agents/skills/babysit-rewrite/discussion-03-codex.md`
- `.agents/skills/babysit-rewrite/discussion-04-opus.md`
- `.agents/skills/babysit-rewrite/discussion-05-fable.md`
- `.agents/skills/babysit-rewrite/discussion-06-opus.md`

Settled behavior:

- one round is one completed review of one head plus one batched disposition;
- findings are `fix`, `fold`, `narrow`, `defer`, or `decline`;
- any file-changing fix or narrow creates a new head and round;
- at most three finding-bearing rounds; mechanical/infrastructure rounds do not
  spend that budget;
- the repository tripwire, rather than a duplicated list, owns the defensive
  complexity stop;
- a deferred item becomes work only with user authorization through
  `start-issue`;
- red CI can be diagnosed before automated review completes;
- dispositions can complete a review without seeking another clean review when
  the head did not change.

Use `origin/main`, not either worktree copy, when comparing or patching the
promoted skill.

## Start-issue: current work

Opus's rewrite is ready for its first Codex editor pass:

- `.agents/skills/start-issue-rewrite/SKILL.md`
- `.agents/skills/start-issue-rewrite/discussion-01-opus.md`
- `.agents/skills/start-issue-rewrite/rewrite-context.md`
- `.agents/skills/start-issue-rewrite/references/interview.md`
- `.agents/skills/start-issue-rewrite/references/work-item-routing.md`
- `.agents/skills/start-issue-rewrite/references/tracker-selection.md`
- `.agents/skills/start-issue-rewrite/references/markover-review.md`

Its intended five-stage shape is:

1. identify the exact work item and present its identity first;
2. read the visible ledger with one bounded overlap scan;
3. claim visibly and pause on a credible collision;
4. interview only unresolved decisions, including finite `done-when` and
   `excludes` for an open-ended promise;
5. implement, keep lifecycle state truthful, and hand off.

The rewrite intentionally removes owner-token elections, self-demotion,
unbounded stable-snapshot loops, exhaustive reconstruction of every unmarked
tracker item, and whole-tracker rescans after every event. Visible collision
detection plus user recovery is the supported coordination model unless real
evidence establishes a stronger need.

Preserve these observed outcomes:

- diagnosis alone does not start work;
- exact issue identity precedes interview prose;
- discoverable facts are found rather than asked;
- one bounded change does not acquire issue-plus-PR ceremony;
- `apply now` remains distinct from `record for later`;
- Markover's canonical/development instance distinction remains truthful;
- chosen durable follow-ons require authorization;
- open-ended promises receive observable completion evidence and explicit
  exclusions before implementation authorization.

## Next editor pass

Review Opus's current files against `rewrite-context.md`, the root tripwire, the
promoted babysit contract, and the original start-issue skill. Resolve only
material correctness problems. Opus explicitly asks for judgment on:

1. whether detect-and-pause is sufficient for same-item concurrency;
2. whether `done-when` and `excludes` are the clearest persisted boundary;
3. whether the proportionality checkpoint is justified by the actual #101
   thread evidence; and
4. whether the live-evidence eval should test honest freshness rather than
   exhaustive tracker reconstruction.

Complete the editor pass when every material contradiction with the evidence,
tripwire, or babysit handoff is identified, while Opus's wording and structure
remain intact. Do not expand the review into redesigning trackers, Markover, or
the eval system.
