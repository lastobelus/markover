# Thread-metadata guidance comparison

This bounded evaluation answers issue #146: whether adding a structured
flag-to-portable-field reference materially improves agent conformance over
Markover's current prose and command usages.

The baseline condition receives the exact machine-readable `helpPayload()`.
The candidate condition receives that same payload plus the tracked
`candidate.json` object. Both conditions receive the same scenario and neutral
structured-output contract. The output contract deliberately keeps the nested
portable metadata as a JSON string so it does not reveal the `agentThread`
shape being evaluated.

## Finite matrix

The one authorized run contains 24 trials: three cases, two conditions, two
models at medium reasoning, and two repetitions. Infrastructure failures may
use the configured bounded retries. Semantic failures are never retried.

```sh
npm run eval:metadata-guidance:validate
npm run eval:metadata-guidance
```

The runner requires a clean worktree, isolates Codex from user configuration,
rules, skills, apps, tools, network access, and project guidance, and retains a
sanitized bundle under `results/`. It records model outputs and deterministic
scores, not private Codex thread identifiers or raw host paths.

## Decision rule

The candidate is eligible for a future implementation plan only when it has no
JSON-input misconception or guessed-metadata error, regresses no case/model
stratum, and improves exact conformance for both models. A tie or any failed
gate retains the current simpler help.

This is a one-time comparison, not a recurring conformance program. The runner
remains reproducible evidence, but rerunning it requires separately authorized
work.

## Recorded outcome

The authorized run passed the candidate gate for `open`, the command exercised
by every matrix case. Review subsequently identified that `get-for-review`
persists reviewer metadata at a different portable path; the decision therefore
does not accept or plan that untested part of the frozen candidate. See
[`decision.md`](decision.md) for the decision and focused implementation plan,
and
[`results/20260818T050906142Z__ded16636__e01830eb`](results/20260818T050906142Z__ded16636__e01830eb/README.md)
for retained evidence.
