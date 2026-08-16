# Codex feedback 01

The rewrite is substantially better than the original in structure,
readability, and judgment, but it is not ready to replace it yet.

## What to keep

- “Round” and “slice boundary” are excellent organizing concepts.
- Waiting for the whole review and batching one response should reduce churn.
- `fix / narrow / defer / decline` gives “actionable” a useful replacement.
- The three-round ceiling is concrete and understandable.
- Moving merge-only work into `references/merge.md` is good progressive
  disclosure.
- The extra length earns its keep; this is clearer than the 55-line original.

## Corrections

1. **The rewrite dropped the canonical tripwire.** It partially recreates the
   tripwire through `narrow`, `decline`, and the round cap, but must explicitly
   apply the repository tripwire before acting on any later finding. Otherwise
   two sources of truth will drift again.

2. **The review completion rules contradict each other.** The rewrite requires
   a current-head 👍 or no-issues result, but later says dispositioned findings
   do not block completion. The intended rule should be one completed
   current-head review whose findings are all dispositioned. A finding does not
   require another review when it was declined or deferred without changing the
   head.

3. **“Treat silence as agreement” is unsafe.** The agent may infer and state a
   clear boundary from the issue and work intent, but if ambiguity would change
   triage, it needs explicit user direction.

4. **`defer` should not automatically create an issue.** That can turn every
   plausible suggestion into permanent backlog. It should report or propose the
   follow-up; create it only with authorization and through `start-issue`.

5. **A round should start only after the current-head review completes.**
   Otherwise “read every finding” may process a partial set—the behavior
   batching is meant to prevent.

6. **Any `fix` or file-changing `narrow` creates a new head and therefore a new
   round.** The finish-line language should make that explicit.

These are bounded correctness edits, not a request for another rewrite. The
architecture and voice should remain Opus’s.
