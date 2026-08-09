# Annotation interpretation evaluation

> **Diagnostic failed evidence.** Removing evaluator descriptions exposed a
> genuine fixed-contract gap: one guided Luna response converted a discussion
> concern into an edit without substantively addressing it. The contract was
> strengthened and validated by the
> [canonical run-local-schema rerun](../2026-08-09T111819926Z__3a05bcb__ea22fce7/README.md).

**Result: FAIL**

Run ID: `2026-08-09T091822045Z__c38ad9b__4c75d0d9`

## Reliability gates

| Gate | Observed | Required |
| --- | ---: | ---: |
| Judge control accuracy | 1 | 1 |
| Guided required-signal rate | 0.9722222222222222 | 1 |
| Guided forbidden-signal count | 1 | 0 |
| Guided passing trials | 23/24 | all |

## Trial summary

| Model | Condition | Trials | Passed | Failed |
| --- | --- | ---: | ---: | ---: |
| gpt-5.6-sol | guided | 12 | 12 | 0 |
| gpt-5.6-sol | unguided | 12 | 12 | 0 |
| gpt-5.6-luna | guided | 12 | 11 | 1 |
| gpt-5.6-luna | unguided | 12 | 8 | 4 |

The unguided condition is descriptive. It does not impose an improvement gate when the baseline already passes.

## Provenance

- Git commit: `c38ad9b7aa0f82f23763ec61d438f81949526dc2`
- Git branch: `t3code/deterministic-fixtures-runner`
- Codex CLI: `codex-cli 0.147.0`
- Started: 2026-08-09T09:18:22.057Z
- Completed: 2026-08-09T09:47:03.970Z

## Evidence layout

- `manifest.json` contains machine-readable configuration, provenance, gates, control results, and trial summaries.
- `inputs/` contains the exact versioned cases, config, rubric, judge schema, and agent guidance used by the run.
- `controls/` contains every structured judge-control invocation and judgment.
- `trials/` contains prompts, sanitized JSONL event streams, stderr, timing, usage, responses, documents, and judgments.

Absolute local paths are replaced with stable placeholders, and command-output payloads are redacted from published JSONL. Credentials and unrelated environment variables are never collected.
