# Annotation interpretation cases

These cases dogfood Markover's initial agent guidance without introducing a
model runner or an LLM judge. Each case describes a small review and the
observable semantic signals required from an outcome. Positive and negative
controls keep the rubric executable in the ordinary test suite.

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

This run is directional evidence only. It is neither independent nor
cross-model, and it establishes no reliability threshold. Automated agent
execution, judging, version capture, and baselines are tracked in issue 46 for
the Broad announcement milestone.

## Running the controls

Run the normal test suite:

```sh
npm test
```

`test/agent-guidance-evals.test.ts` verifies that every positive control passes
and every negative control fails for a specific stated reason. In particular,
the controls fail when a question is acted on but not acknowledged.
