# Annotation interpretation cases

These cases dogfood Markover's agent guidance. Each case describes a small
review and the observable semantic signals required from an outcome. Positive
and negative controls keep the rubric executable in the ordinary test suite
and calibrate the model judge before a live matrix starts.

The signals are evaluation vocabulary, not a required agent response format.
Real agents remain free to revise files and respond naturally in the thread.

## Manual run

An initial single-pass reading was performed on 2026-08-03 with the frontier
agent used to implement issue 7. No external tools or hidden project context
were used while interpreting the four case texts.

| Case | Result | Representative user-facing handling |
| --- | --- | --- |
| `mixed-revision-question` | Pass | Renamed the section and separately addressed why the available text did not establish Redis over SQLite. |
| `question-as-useful-direction` | Pass | Removed the unsupported fallback and acknowledged that it had no demonstrated place in the document. |
| `discussion-with-context` | Pass | Addressed the latency concern while using the mobile-client history as context rather than silently rewriting it as rationale. |
| `qualified-source-proposal` | Pass | Treated five retries as a proposal, surfaced the upstream-load question, and did not assume the edit should be applied. |

This historical run is directional evidence only. It is neither independent
nor cross-model, and it establishes no reliability threshold. The automated
runner below supersedes it as the repeatable evidence path.

## Running the controls

Run the normal test suite:

```sh
npm test
```

`test/agent-guidance-evals.test.ts` verifies that every positive control passes
and every negative control fails for a specific stated reason. In particular,
the controls fail when a question is acted on but not acknowledged.

## Validating the live runner

Run the static validation without making model calls:

```sh
npm run eval:annotation:validate
```

Validation checks the four cases, versioned configuration, 48-trial matrix,
judge schema and rubric, installed Codex CLI version, and bundled availability
of `gpt-5.6-sol` and `gpt-5.6-luna`. The ordinary test suite also verifies the
prompt boundary, isolated Codex configuration, JSONL parsing, structured judge
contract, exact thresholds, and path sanitization.

## Running the live evaluation

Start only from a clean Git worktree so the recorded commit identifies the
exact runner and prompts:

```sh
npm run eval:annotation
```

The runner uses saved Codex CLI authentication but ignores user configuration,
rules, apps, MCP servers, skills, project guidance, web search, and network
access. Each evaluated-agent trial runs ephemerally in a fresh Git repository
with workspace-write access limited to its fixture. The judge runs ephemerally
and read-only with shell, web search, apps, agents, and image tools disabled.
Evaluated-agent prompts contain only task instructions and the review artifacts;
case descriptions and signal expectations remain evaluator-only.

The first gate runs eight fixed artifact-based judge controls. The judge sees
only each review, original document, final document, response, rubric, and
signal definitions; it is not given the expected signal decisions or outcome.
Calibration compares every required and forbidden signal decision with the
independently expected observations, so a negative control that fails for the
wrong reason is itself a control failure.
Any valid control misclassification stops the run before evaluated agents
execute. Infrastructure failures are recorded and retried at most twice; valid
semantic failures are never retried. Before each infrastructure retry, the
runner recreates the fixture workspace from its original document and review so
attempts cannot accumulate edits or extra files. Trials then execute
sequentially across:

- four cases;
- `gpt-5.6-sol` and `gpt-5.6-luna` at medium reasoning;
- guided and unguided conditions; and
- three trials per case, model, and condition.

That produces 48 evaluated-agent executions and 48 high-reasoning
`gpt-5.6-sol` judgments, in addition to the eight judge controls. Guided runs
pass only when every required signal is observed and no forbidden signal is
observed. A missing, non-regular, or oversized final document fails the trial.
So does a changed `review.json`, missing runner metadata, or any unexpected
workspace entry. These integrity checks are automatic even if response-level
signals otherwise pass. Unguided results are descriptive and do not impose an
improvement requirement.

## Evidence and privacy

The canonical committed evidence is
[`2026-08-09T103323212Z__54e1387__577e4846`](results/2026-08-09T103323212Z__54e1387__577e4846/README.md).
It passed every signal decision in all eight artifact-based judge controls and
all 24 guided trials without exposing evaluator descriptions to evaluated
agents, publishing raw command output, or admitting unexpected workspace
changes. The failed hint-free run is preserved because it exposed a real gap:
the fixed contract did not explicitly require substantive engagement with
discussion and concerns. The other earlier bundles remain available for
historical analysis but are superseded because their admission controls were
weaker or their published evidence retained evaluator hints or host-identifying
command output.

Execution state is written beneath ignored
`tmp/annotation-interpretation/<run-id>/`. A complete matrix is promoted to
`results/<run-id>/`, whether its reliability gate passes or fails, so failures
remain auditable rather than being cherry-picked away.

Every run ID reserves a new ignored workspace. An existing run workspace is
rejected rather than resumed or reused, preventing stale attempts from entering
a later evidence bundle.

The committed bundle contains the exact inputs and hashes—including a snapshot
and hash of the evaluated runner—requested model and reasoning settings,
bundled model metadata, Codex CLI version, Git provenance, prompts, sanitized
JSONL event streams, stderr, timing, token usage, responses, documents,
judgments, errors, a machine-readable manifest, and a Markdown report.
Published JSONL retains event structure, commands, statuses, and model messages,
but replaces command-output payloads with a redaction marker so filesystem
ownership and other host metadata cannot enter committed evidence.
Unsanitized streams stay only under ignored `tmp/`. The runner never collects
credentials, environment variables, or unrelated machine state, and replaces
local absolute paths in every model-derived artifact with stable placeholders
before atomically publishing the evidence directory.
