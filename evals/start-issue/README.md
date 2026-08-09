# Start-issue behavior cases

These cases exercise the repository's `start-issue` coordination contract
without invoking an agent or querying GitHub. Each fixture records normalized
facts available to an agent and the semantic actions a compliant run must take
or avoid.

## Fixture contract

`observations` retain behaviorally relevant state: whether a work item exists,
its tracker attachments, tracker lifecycle state, resolved tracker decisions,
and the current interview checkpoint. They omit live item totals, GraphQL node
IDs, timestamps, and unrelated response fields.

`requiredActions` and `forbiddenActions` are evaluation vocabulary, not a
required response or tool-call format. A future agent runner may translate a
real trace into these signals without changing the cases.

Every positive control contains all required actions and no forbidden action.
Every negative control declares the exact missing and forbidden actions its
trace must produce, preventing an unrelated failure from satisfying the test.

The two fresh-work cases distinguish delivery shape without requiring GitHub
state: one PR in one session uses that PR as its only work item; work that may
span PRs or sessions, coordinates roadmap items, or is scheduled for later uses
an issue.

## Provenance

Synthetic cases use `provenance.kind: synthetic`. A case derived from a live
run records source thread IDs and a concise observation, while raw transcripts
and T3 storage paths stay outside the corpus. Provenance explains why a case
exists; it does not become fixture input.

The post-claim scan case comes from the same failure in a pre-#66 run and a run
using merged #66 guidance: both refreshed candidate IDs and markers but reused
pre-claim evidence for unmarked Project items. This repeated observation makes
the freshness requirement evidence-backed without coupling tests to either
transcript.

The two merged-PR follow-up cases come from a cleanup run that created both
issue #72 and draft PR #73 for an immediately implemented fix. They separate
the intended branches: apply now creates one tracked follow-up pull request;
record for later chooses a tracker and stops after creating the linked issue.

The Markover instance cases protect the landed #61 isolation boundary without
making an open pull request select development by default. Ordinary plan and
artifact reviews stay canonical. An explicit request to test the pull request
opens a PR-specific checklist in that worktree's development instance, retains
the selector with its review ID, and preserves instance state through routine
handoff.

## Running the controls

Run the normal test suite:

```sh
npm test
```

`test/start-issue-evals.test.ts` validates the corpus shape, rejects volatile
GitHub fixture fields, accepts each positive control, and rejects each negative
control for its declared reasons.
