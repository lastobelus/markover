# Live review metadata conformance

This program checks whether real agents turn Markover's machine-readable guidance
into truthful portable `review.agentThread` snapshots. The bounded structural
fixtures in `cases.json` remain contract tests; the matrix and evidence directory
record live product behavior.

The current installed-product and environment-probe baseline is recorded in
[`capability-audit.md`](capability-audit.md). It separates installation from a
proven invocation path and never records literal session identifiers.

## Workflow

1. Select an exact host/provider row and identity route from `matrix.json`, then
   follow its exercise.
2. Keep the retrieved review and capture observation under ignored `tmp/`.
3. Run `npm run eval:metadata:record --` with those two inputs. The command first
   applies the shared v1 decoder and the rubric, then writes a fixture containing
   placeholders for the particular thread IDs and machine name from that run.
4. Inspect the fixture, add its ID to the matrix row, and run
   `npm run eval:metadata:validate`.
5. Before declaring the matrix complete, run
   `npm run eval:metadata:validate -- --require-complete`.

The recorder creates its output exclusively and never overwrites an existing
file. Its local input stays under `tmp/review-metadata/` and is not part of the
checked-in fixture corpus.

```sh
npm run eval:metadata:record -- \
  --review tmp/review-metadata/raw-review.json \
  --observation tmp/review-metadata/observation.json \
  --output evals/review-metadata/evidence/EVIDENCE_ID.json
```

## Observation shape

Copy this template under ignored `tmp/review-metadata/` and fill only values
observed in the live run:

```json
{
  "schemaVersion": 2,
  "evidenceId": "2026-08-12__t3code-codex__1234abcd",
  "matrixEntryId": "t3code-codex",
  "identityRoute": "explicit-runtime",
  "exercisedAt": "2026-08-12T12:34:56.789Z",
  "runtime": {
    "hostVersion": null,
    "hostVersionSource": "not-exposed",
    "providerVersion": null,
    "providerVersionSource": "not-exposed",
    "providerModel": null,
    "providerModelSource": "not-exposed"
  },
  "discovery": {
    "providerThreadId": { "status": "observed", "source": "agent-runtime" },
    "hostKind": { "status": "observed", "source": "thread-context" },
    "hostProvider": { "status": "observed", "source": "thread-context" },
    "hostThreadId": { "status": "unavailable", "source": "not-exposed" },
    "machine": { "status": "observed", "source": "hostname-command" }
  },
  "truthfulnessAttested": true,
  "limitations": ["The thread host did not expose a product version."]
}
```

Allowed version sources are `command`, `runtime-context`, and `not-exposed`.
Allowed discovery sources are `agent-runtime`, `thread-context`,
`thread-host-runtime`, `local-session-handoff`, `hostname-command`, `not-exposed`,
and `not-applicable`. Use `agent-runtime` for the `explicit-runtime` route and
`local-session-handoff` for the `handoff-key` route.

## Rerun triggers

Rerun an affected row when Markover's metadata guidance or validator changes, a
host or provider changes identity discovery, a product/model version changes
materially, a new host/provider combination becomes available, or an observed
snapshot drifts from the last committed evidence. Replace the affected baseline
fixture when the prior result is no longer representative. Add new combinations
only after exercising them. Matrix product strings remain observational evidence;
issue #134 owns normative classification and aliases.

## Current evidence

The three 2026-08-12 fixtures predate the current explicit-ID-or-fresh-key
guidance. They keep the corpus structurally valid while checkpoint 5 replaces
them with current explicit and fallback runs and exercises all six required
surfaces:

| Combination | Existing runtime evidence | Checkpoint 5 state |
| --- | --- | --- |
| Codex CLI × Codex | Codex CLI `0.147.0`; model and provider service version not exposed | Current explicit and handoff runs pass. |
| ChatGPT Codex view × Codex | None | Handoff run required; explicit run also required if the app exposes `CODEX_THREAD_ID`. |
| T3 Code × Codex | T3 Code Nightly `0.0.34-nightly.20260817.1113`; `gpt-5.6-sol`; provider runtime version not exposed | Current explicit and handoff runs pass. |
| T3 Code × Claude | `claude-sonnet-5`; Claude Agent SDK 0.3.227; T3 Code version not exposed | Replace baseline with current explicit and handoff runs. |
| Claude Code × Claude | Claude Code `2.1.234`; `claude-sonnet-5`; provider service version not exposed | Current explicit and handoff runs pass. |
| Claude desktop × Claude | None | Handoff run required; explicit run also required if the app exposes `CLAUDE_CODE_SESSION_ID`. |

Each fixture retains discovery limitations and ID relationships. The particular
thread IDs and machine name from the live run are represented by obvious
placeholders because their literal values do not help evaluate the guidance.
