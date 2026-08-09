# Annotation interpretation evaluation

**Result: PASS**

Run ID: `2026-08-09T111819926Z__3a05bcb__ea22fce7`

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

- Git commit: `3a05bcbbd33d2e4d95e1d5139d4784289ce828c1`
- Git branch: `t3code/deterministic-fixtures-runner`
- Codex CLI: `codex-cli 0.147.0`
- Started: 2026-08-09T11:18:19.935Z
- Completed: 2026-08-09T11:45:42.244Z

## Evidence layout

- `manifest.json` contains machine-readable configuration, provenance, gates, control results, and trial summaries.
- `inputs/` contains the exact versioned cases, config, rubric, judge schema, and agent guidance used by the run.
- `controls/` contains every structured judge-control invocation and judgment.
- `trials/` contains prompts, sanitized JSONL event streams, stderr, timing, usage, responses, documents, workspace-integrity status, and judgments.

Absolute local paths are replaced with stable placeholders, and command-output payloads are redacted from published JSONL. Credentials and unrelated environment variables are never collected.
