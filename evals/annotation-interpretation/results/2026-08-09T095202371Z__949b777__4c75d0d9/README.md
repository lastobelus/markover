# Annotation interpretation evaluation

> **Superseded evidence.** This hint-free, output-redacted run passed its
> semantic gates but did not yet reject changes to `review.json` or unexpected
> workspace entries. Use the
> [canonical run-local-schema rerun](../2026-08-09T111819926Z__3a05bcb__ea22fce7/README.md).

**Result: PASS**

Run ID: `2026-08-09T095202371Z__949b777__4c75d0d9`

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
| gpt-5.6-luna | unguided | 12 | 8 | 4 |

The unguided condition is descriptive. It does not impose an improvement gate when the baseline already passes.

## Provenance

- Git commit: `949b7776fdbb347f38629043d2238b0abe2ace3e`
- Git branch: `t3code/deterministic-fixtures-runner`
- Codex CLI: `codex-cli 0.147.0`
- Started: 2026-08-09T09:52:02.383Z
- Completed: 2026-08-09T10:19:45.209Z

## Evidence layout

- `manifest.json` contains machine-readable configuration, provenance, gates, control results, and trial summaries.
- `inputs/` contains the exact versioned cases, config, rubric, judge schema, and agent guidance used by the run.
- `controls/` contains every structured judge-control invocation and judgment.
- `trials/` contains prompts, sanitized JSONL event streams, stderr, timing, usage, responses, documents, and judgments.

Absolute local paths are replaced with stable placeholders, and command-output payloads are redacted from published JSONL. Credentials and unrelated environment variables are never collected.
