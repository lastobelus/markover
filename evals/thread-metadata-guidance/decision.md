# Structured thread-metadata guidance decision

- **Status:** Accepted for a future focused implementation.
- **Issue:** #146.
- **Evidence:** [`20260818T050906142Z__ded16636__e01830eb`](results/20260818T050906142Z__ded16636__e01830eb/README.md).

## Decision

Plan an additive `threadMetadata` object in Markover's machine-readable help.
It will map CLI flags to their resulting portable fields, declare
`inputMode: "flags-only"`, identify unavailable optional fields as omitted,
preserve truthful nonblank host/provider strings as open values, and include a
non-normative example with its own `exampleVersion`. `open` and
`get-for-review` remain flags-only; this decision does not authorize JSON input.

## Evidence

| Condition | Correct commands | Correct portable shape | JSON-input errors | Guessed metadata |
| --- | ---: | ---: | ---: | ---: |
| Current prose and usages | 12/12 | 0/12 | 0 | 12 |
| Structured candidate | 12/12 | 12/12 | 0 | 0 |

Both models improved from 0/6 to 6/6 exact conformance. Every baseline agent
selected the correct flags but guessed a flat or otherwise incorrect portable
shape; every candidate agent produced the required nested `agentThread` shape.
The candidate therefore passed the precommitted rule: zero critical errors, no
case/model regression, and improvement in both models.

## Focused implementation plan

1. Add one typed metadata-help descriptor as the active authoring source for
   the structured reference and the metadata fragments in `commands[].usage`.
   Keep the portable v1 schema, `review-handoff-format.md`, and runtime decoder
   authoritative for field validity; the evaluated candidate remains a frozen
   evidence input rather than a second live source.
2. Project the descriptor into `helpPayload().threadMetadata` without changing
   command parsing. Keep its version-1 example explicitly illustrative and
   bump `exampleVersion` only when the demonstrated shape or meaning changes.
3. Add contract tests that send every mapped flag through the real CLI parser,
   compare the produced nested metadata, and validate a complete artifact with
   the real portable decoder. Cover omitted unavailable optionals, truthful
   unknown kind/provider values, explicit and handoff-key routes, and the
   absence of any JSON input path.
4. Update focused machine-help assertions and agent documentation only where
   they point to the generated reference. Do not add a schema framework,
   compatibility reader, alternate input mode, or recurring live evaluation.

The implementation should be claimed as a separate slice. The one-time #146
matrix is complete and is not a standing rerun requirement.
