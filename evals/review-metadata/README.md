# Live review metadata conformance

This program checks whether real agents turn Markover's machine-readable guidance
into truthful portable `review.agentThread` snapshots. The bounded structural
fixtures in `cases.json` remain contract tests; the matrix and evidence directory
record live product behavior.

## Workflow

1. Select an exact host/provider row from `matrix.json` and follow its exercise.
2. Keep the raw `get` artifact and capture observation under ignored `tmp/`.
3. Push the runner commit to the declared pull request, then run
   `npm run eval:metadata:record --` with those two inputs. The command verifies
   that the commit is in that PR's fetched head history and that the running
   recorder inputs match that commit, applies the shared v1 decoder and the
   rubric, then writes a reduced record.
4. Inspect the reduced JSON, add its ID to the matrix row, and run
   `npm run eval:metadata:validate`.
5. Before declaring the matrix complete, run
   `npm run eval:metadata:validate -- --require-complete`.

The recorder creates its output exclusively and never overwrites an existing
file. Raw artifacts stay under `tmp/review-metadata/` and are never promoted.
Free-form observation limitations also stay in the ignored observation; the
committed record retains their structured discovery and runtime facts only.
The recorder requires a matching GitHub `origin` and read access to the
declared pull-request head ref so runner provenance cannot point elsewhere.

## Classification ownership

Treat every product label and `threadHost.kind`/`provider` pair in this corpus as
provisional evidence from its recorded run. Issue #134 owns normative product
classification and aliases. Until that specification lands, add an exact row
only when the live thread makes both roles unambiguous; retain ambiguous future
products as host-only `expansionCandidates` with `discover-at-exercise`.

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
  "schemaVersion": 1,
  "evidenceId": "2026-08-12__t3code-codex__1234abcd",
  "matrixEntryId": "t3code-codex",
  "exercisedAt": "2026-08-12T12:34:56.789Z",
  "sourceCommit": "REPLACE_WITH_FULL_GIT_COMMIT_SHA",
  "sourcePullRequest": "https://github.com/OWNER/REPOSITORY/pull/NUMBER",
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
Non-null runtime values must be normalized version/model tokens: one to five
space-separated alphanumeric segments using only `.`, `_`, `+`, or `-` within
segments. Extract that token from command output; never copy paths, URLs, or
unparsed command output into an observation.
Allowed discovery sources are `agent-runtime`, `thread-context`,
`thread-host-runtime`, `hostname-command`, `not-exposed`, and `not-applicable`.

## Rerun triggers

Rerun an affected row when Markover's metadata guidance or validator changes, a
host or provider changes identity discovery, a product/model version changes
materially, a new host/provider combination becomes available, or an observed
snapshot drifts from the last committed evidence. Add a new immutable evidence
record; keep earlier records as history.

Expansion candidates name hosts only. Choose their provider from the live thread
at exercise time, then add an exact matrix row. This keeps LastCode, direct
provider hosts, OpenCode, Cursor, and future mixed combinations visible without
inventing provider identity. Revisit affected rows after #134 publishes its
normative classification. Candidate context uses only the closed reason codes
`no-live-thread` and `provider-not-observed`; keep free-form notes outside the
committed corpus.

## Initial evidence

The 2026-08-12 baseline exercises all three initial rows. The original records
retain runner commit `82df4d6ecd95be511ede2ccb0113e126c46d416d` as history. Each
same-run raw artifact was re-recorded through hardened runner commit
`a5fec04fac192db4da3cafb73df38db8f112d626`, then through duplicate-aware,
PR-provenance-verifying runner commit
`1c56bdf7019c0573afe7ae0c0605a9938e336a98`. All three immutable records per
combination remain referenced by the matrix.

`sourcePullRequest` is the durable provenance root for pre-squash runner
commits. GitHub retains the pull-request head ref after a squash merge, so a
clean checkout can inspect a recorded runner with:

```sh
git fetch origin refs/pull/141/head
git show SOURCE_COMMIT:scripts/review-metadata-conformance.ts
```

| Combination | Runtime evidence | Result |
| --- | --- | --- |
| T3 Code × Codex | `gpt-5.6-sol`; T3 Code and provider versions not exposed | Pass |
| T3 Code × Claude | `claude-sonnet-5`; Claude Agent SDK 0.3.227; T3 Code version not exposed | Pass |
| Claude Code × Claude | Claude Code 2.1.228; `claude-sonnet-5`; provider service version not exposed | Pass |

Each record retains structured discovery limitations, ID relationships, and
typed redaction markers. No raw provider ID, host ID, hostname, session path,
free-form observation text, or account data is committed.
