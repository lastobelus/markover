# Live review metadata conformance

This program checks whether real agents turn Markover's machine-readable guidance
into truthful portable `review.agentThread` snapshots. The bounded structural
fixtures in `cases.json` remain contract tests; the matrix and evidence directory
record live product behavior.

The current installed-product and environment-probe baseline is recorded in
[`capability-audit.md`](capability-audit.md). It separates installation from a
proven invocation path and never records literal session identifiers.

## Workflow

1. Select an exact host/provider row from `matrix.json`, then run its exercise
   from the checkout being evaluated.
2. Run the exercise helper's `prepare` command, then run the exact
   `captureCommand` it returns as a second agent tool call. `prepare` emits one
   fresh handoff marker so the provider persists it before discovery. `capture`
   reads only the provider's applicable session variable, runs `hostname`, opens
   and retrieves each declared route, and writes a mode-0600 bundle beneath
   ignored `tmp/review-metadata/runs/`.
3. Inspect the raw review, generated observation, and sanitized fixture candidate.
   The helper never enumerates the environment or edits tracked evidence or the
   matrix. Run `npm run eval:metadata:record --` with the bundle's raw review and
   observation to create the tracked fixture through the authoritative recorder.
4. Add the fixture ID to the matrix row and run
   `npm run eval:metadata:validate`.
5. Before declaring the matrix complete, run
   `npm run eval:metadata:validate -- --require-complete`.

The recorder creates its output exclusively and never overwrites an existing
file. Its local input stays under `tmp/review-metadata/` and is not part of the
checked-in fixture corpus.

```sh
npm --silent run eval:metadata:exercise -- prepare \
  --entry MATRIX_ENTRY \
  [--routes explicit-runtime,handoff-key] \
  [--thread-host-thread-id OBSERVED_DISTINCT_HOST_ID]
```

`prepare` deliberately emits the fresh handoff marker once so the provider log
can persist it. Run the returned `captureCommand` exactly. Its result names only
the route, evidence ID, and private bundle paths; it does not repeat the marker
or expose review IDs, provider-session IDs, host IDs, or machine names.

```sh
npm run eval:metadata:record -- \
  --review tmp/review-metadata/raw-review.json \
  --observation tmp/review-metadata/observation.json \
  --output evals/review-metadata/evidence/EVIDENCE_ID.json
```

## Recorder input shape

The helper creates this observation from the selected matrix row, declared
routes, allowlisted runtime ID, optional observed host ID, and hostname result:

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

The current corpus exercises every required identity route across all six
installed surfaces:

| Combination | Existing runtime evidence | Checkpoint 5 state |
| --- | --- | --- |
| Codex CLI × Codex | Codex CLI `0.147.0`; model and provider service version not exposed | Current explicit and handoff runs pass. |
| ChatGPT Codex view × Codex | ChatGPT `26.810.52044`; current handoff capture recovers the exact Codex thread; `CODEX_THREAD_ID` was not exposed | Current required handoff run passes. |
| T3 Code × Codex | T3 Code Nightly `0.0.34-nightly.20260817.1113`; `gpt-5.6-sol`; provider runtime version not exposed | Current explicit and handoff runs pass. |
| T3 Code × Claude | Current explicit and handoff captures recover one Claude session plus its distinct T3 host thread; versions were not exposed to the helper | Current explicit and handoff runs pass. |
| Claude Code × Claude | Claude Code `2.1.234`; `claude-sonnet-5`; provider service version not exposed | Current explicit and handoff runs pass. |
| Claude desktop × Claude | Claude `1.30096.5`; explicit and handoff captures recover the same persisted session; `CLAUDE_CODE_SESSION_ID` is nonblank inside the agent | Current explicit and handoff runs pass. |

Each fixture retains discovery limitations and ID relationships. The particular
thread IDs and machine name from the live run are represented by obvious
placeholders because their literal values do not help evaluate the guidance.
