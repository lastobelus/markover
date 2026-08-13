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
   rubric, verifies the immutable review content matches `exercise-source.md`,
   then writes a reduced record.
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
If a truthful artifact fails an automatic check, first create or link its
contract defect as a GitHub sub-issue descendant of #99, then rerun the same record command with
`--defect-issue NUMBER`. The recorder writes a closed failure record containing
only corpus identity, provenance, and the defect link; it omits the raw artifact,
runtime values, discovery details, and error text. A failed record cannot satisfy
`--require-complete` without at least one passing record for the same matrix row.
Recording and later corpus validation walk GitHub's bounded `parent` hierarchy,
require every issue to remain in the source PR repository, and fail unless the
chain reaches #99.

## Classification semantics

Issue #134 defines `threadHost.kind` as the user-facing product or lookup
namespace and `threadHost.provider` as the observed LLM provider or model family,
not an intermediate harness. Exact product labels and pairs in this corpus remain
observational evidence from their recorded runs. Add an exact row only when the
live thread makes both roles unambiguous; retain ambiguous future products as
host-only `expansionCandidates` with `discover-at-exercise`.

`agentThread.id` records the best observable requesting-thread or session ID. An
equal `threadHost.threadId` is valid, although agent guidance recommends omitting
it unless it is a distinct host-owned identifier.

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

Expansion candidates name hosts only. Choose their LLM provider/model family
from the live thread at exercise time, then add an exact matrix row. This keeps
LastCode, direct provider hosts, OpenCode, Cursor, and future mixed combinations
visible without inventing LLM provider/model-family identity. Candidate context uses only the closed reason codes
`no-live-thread` and `provider-not-observed`; keep free-form notes outside the
committed corpus.

## Initial evidence

The 2026-08-12 baseline exercises all three initial rows. The original records
retain runner commit `82df4d6ecd95be511ede2ccb0113e126c46d416d` as history. Each
same-run raw artifact was re-recorded through hardened runner commit
`a5fec04fac192db4da3cafb73df38db8f112d626`, then through duplicate-aware,
PR-provenance-verifying runner commit
`1c56bdf7019c0573afe7ae0c0605a9938e336a98`, and finally through source-bound,
closed-corpus runner commits `e562535075a434f9554c535be835591f17025a7b`
and `9e1559d4df4f505d960782f17f64cf8724925520`, the latter binding the actual
build configuration too. Privacy- and containment-hardened runner commit
`0fce000ea82942ccdab87e7fc1bd80d9743903b0` produced the next records, followed
by private-token-segment-hardened runner commit
`ffbe48d1a3d7121d39c5958c9ba5a7f85c1649e0`, then ID-slug-bound runner commit
`159e8801c67478c9d35b7a7368809484dbc3d6d1`. Exercise-source-bound and
failure-retaining runner commit `20bdc87b121e6b141254b88aa8e9d5dbd978ab85`
produced the next records, followed by defect-ancestry-verifying runner commit
`30239c3cc1dc6e31b29a5491657fe14f7c97c86e`, then all-artifact-string privacy
runner commit `4347774bc7644631f5bf98a7d40e3e772f1a4bb5`, followed by extension-key
privacy runner commit `7266b46701d7cc0df21bc88f9f939f9aa32dab03`, then unified success/failure
privacy runner commit `8d3c0688d787db5f8bc444c3a8e5b71e607c7ecd`, followed by complete
exercise-input and ignored-observation binding in runner commit
`53f2ddfeaaa9b1a4732cd46f6f594a976c260c6e`, then evidence-date and
identifier-sized private-prose binding in runner commit
`e7c4a44cc633712b15d0f175d29969f244674e36`, followed by identifier-component
and failure-date validation in runner commit
`ae35722a27c600f2d5bc536d187a918554cb84ca`, then case-insensitive private-value
comparison in runner commit `8ecb62d86ae16a5d1e5e5736fc817fcb8a8cce1f`, followed by
punctuation-aware runtime containment in runner commit
`a5ab4abca2e11cf51e2a5e714fcbbaef777aafa7`, then numeric-leaf privacy in runner
commit `8d921e2eb2c85ebe211e7a3daddac31d563040b6`. All nineteen immutable
records per combination remain referenced by the matrix. After rebasing onto
the latest `main`, rebased head `4a077eceae1354a554868070204f1215b1269589`
produced a twentieth record for each combination. After stacking on #148, the
#134-aligned runner at `bc4d87cd121f0451ff9aac72d3c810c8653a5f76`
produced a twenty-first record for each combination. Delimiter-stripped
private-identifier comparison in runner commit
`584f85ced53c2b745c018fe6958975ceee04897a` produced a twenty-second record for
each combination after #148 merged. Short-component protection for explicitly
private paths and identifiers in runner commit
`806d09ae47a06ac03cae8e5c3b596cef68d9d4d7` produced a twenty-third record for
each combination. Stable runner-history archival and delimiter-stripped private
path-component comparison in runner commit
`db4f833003fb6d861401252602f2242f360a0896` produced a twenty-fourth record for
each combination. Shared explicit-private normalization for passing and failure
evidence in runner commit `10d7dbef69f48a1373ae77dd50047fe46fb89be7`
produced a twenty-fifth record for each combination. Short complete private-leaf
retention in runner commit `aae18de00aa03a4dacb783ceff222f7c092bb7ba`
produced a twenty-sixth record for each combination. Short safe-numeric private
leaf retention in runner commit `3eaccbd6bd62f40b5d37ed195c9bc64e0cd935a6`
produced a twenty-seventh record for each combination. Explicit attachment
path/URL normalization in runner commit
`f65c5d7e48596706aadfeb64ae608243539629ac` produced a twenty-eighth record for
each combination. Percent-decoded explicit-private candidate comparison in
runner commit `b9a0e1103c2b0f62a69a54f07dc70a34900f84f8` produced a twenty-ninth
record for each combination after the latest `main` integration. Embedded
explicit-private identifier comparison in runner commit
`32aeb2570a10a64c3cb24140055f6f894973af72` produced a thirtieth record for
each combination. Shared runtime and evidence-ID private-substring comparison
in runner commit `c80fe4967b26ca8a932d81e0e4dca7ed92712971` produced a thirty-first
record for each combination. Failure-path substring checks and decoded
complete-private inputs in runner commit
`e2c3ebf24b0c710f7f9930e9dbcb2aca94ca7c24` produced a thirty-second record
for each combination. Field-aware short-identifier containment in runner
commit `bc32ad96ca416bb590441de37533144f1947c5af` produced a thirty-third record
for each combination. Bidirectional private/runtime substring comparison in
runner commit `f5a05e7c96fec9e0821f00491855527ff62045f8` produced a thirty-fourth
record for each combination. Short explicitly private path-component
containment in runner commit `c979810ca3349f5d63840ab287e372d569b6c9c3`
produced a thirty-fifth record for each combination. Short-aware bidirectional
evidence-suffix containment in runner commit
`2c5d3397f92fcd21e0006a4cc522de8488378848` produced a thirty-sixth record for
each combination. Case-insensitive compound identifier-field recognition in
runner commit `b63246ecb27ac7190f4f94bfb5a9864c9024e99f` produced a thirty-seventh
record for each combination. Field-classified identifiers of every non-empty
length in runner commit `82ea8205e05944f1f8046e247381c7bd8a8c91d8`
produced a thirty-eighth record for each combination. Canonical safe-integer
identifier comparison in runner commit
`1e6d7e8a3a1ed35608431445c1f8065979d201a8` produced a thirty-ninth record for
each combination. Short identifier component and complete-private numeric
normalization in runner commit `5ce4f8a7a35ebfac43746b0539ae83fa91a511e2`
produced a fortieth record for each combination.
Radix-form safe-integer identity comparison in runner commit
`6fedd0b7a24616639c55b21f83812d51a93e9c96` produced a forty-first record for
each combination.
Short additive-key containment in runner commit
`93a39dc903a53aa0480aed4fea733f6afddcdc36` produced a forty-second record for
each combination.

`sourcePullRequest` identifies the recording PR. Its rewritten historical
runner commits are retained under the versioned immutable
`issue-136-runner-history-v22` tag, so a clean checkout can inspect any recorded
runner with:

```sh
git fetch origin refs/tags/issue-136-runner-history-v22
git show SOURCE_COMMIT:scripts/review-metadata-conformance.ts
```

| Combination | Runtime evidence | Result |
| --- | --- | --- |
| T3 Code × Codex | `gpt-5.6-sol`; T3 Code and provider versions not exposed | Pass |
| T3 Code × Claude | `claude-sonnet-5`; Claude Agent SDK 0.3.227; T3 Code version not exposed | Pass |
| Claude Code × Claude | Claude Code 2.1.228; `claude-sonnet-5`; provider service version not exposed | Pass |

Each record retains structured discovery limitations, ID relationships, and
typed redaction markers. No raw requesting-thread ID, host ID, hostname,
session path, free-form observation text, or account data is committed.
