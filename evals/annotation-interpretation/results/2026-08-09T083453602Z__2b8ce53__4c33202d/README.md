# Annotation interpretation evaluation

> **Superseded evidence.** This run supplied each case description to the
> evaluated agent and retained raw command-output payloads that could expose
> host ownership metadata. Use the
> [canonical integrity-checked run](../2026-08-09T103323212Z__54e1387__577e4846/README.md).

**Result: PASS**

Run ID: `2026-08-09T083453602Z__2b8ce53__4c33202d`

## Reliability gates

| Gate | Observed | Required |
| --- | ---: | ---: |
| Judge control accuracy | 1 | 1 |
| Guided required-signal rate | 1 | 1 |
| Guided forbidden-signal count | 0 | 0 |
| Guided passing trials | 24/24 | all |

## Trial summary

| Model | Condition | Trials | Passed | Failed |
| --- | --- | ---: | ---: | ---: |
| gpt-5.6-sol | guided | 12 | 12 | 0 |
| gpt-5.6-sol | unguided | 12 | 12 | 0 |
| gpt-5.6-luna | guided | 12 | 12 | 0 |
| gpt-5.6-luna | unguided | 12 | 11 | 1 |

The unguided condition is descriptive. It does not impose an improvement gate when the baseline already passes.

## Provenance

- Git commit: `2b8ce537c6fc194c2e57ecdb656432daedd25266`
- Git branch: `t3code/deterministic-fixtures-runner`
- Codex CLI: `codex-cli 0.147.0`
- Started: 2026-08-09T08:34:53.612Z
- Completed: 2026-08-09T09:01:07.959Z

## Evidence layout

- `manifest.json` contains machine-readable configuration, provenance, gates, control results, and trial summaries.
- `inputs/` contains the exact versioned cases, config, rubric, judge schema, and agent guidance used by the run.
- `controls/` contains every structured judge-control invocation and judgment.
- `trials/` contains prompts, sanitized JSONL event streams, stderr, timing, usage, responses, documents, and judgments.

Absolute local paths are replaced with stable placeholders. Credentials and unrelated environment variables are never collected.
