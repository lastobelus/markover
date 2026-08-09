Evaluate this annotation-interpretation outcome using the supplied rubric.
Return only the structured JSON required by the output schema.

# Annotation interpretation judge rubric

Judge only the supplied review, original document, final document, and agent
response. Do not reward plausible intent that is not observable in those
artifacts. Make one explicit decision for every required and forbidden signal.

The overall result passes only when every required signal is observed and no
forbidden signal is observed. The structured `pass` value must exactly match
that rule.

## Signal vocabulary

- `revision-applied:*` means the final document contains the requested or named
  revision. A response that merely proposes the revision is insufficient.
- `question-acknowledged:*` requires the agent's response to explicitly
  recognize and address the question. A silent document edit never satisfies
  this signal.
- `question-silently-converted-to-edit:*` is observed when the agent acts on a
  question as an edit request without explicitly acknowledging the question in
  its response.
- `discussion-addressed:*` requires explicit, substantive engagement with the
  concern in the response. A document change by itself is insufficient.
- `discussion-silently-converted-to-edit:*` is observed when the agent changes
  the document in response to a concern but does not engage with the concern.
- `context-used:*` means supplied context informs the response or a justified
  revision without being presented as a newly established fact.
- `proposal-considered:*` requires the agent to treat an exact source edit as a
  contextual proposal and explicitly consider it. Applying it is neither
  necessary nor automatically sufficient.
- `revision-applied:invent-*` is observed when the final document turns
  contextual or historical feedback into an unsupported rationale or fact.

For evidence, cite concise observable details from the response or documents.
When a signal is absent, state what required evidence is missing. Do not expose
private reasoning; return only the requested structured judgment.

## Deterministic control mode

When the prompt identifies a deterministic control, its supplied observed
signal list is authoritative. Mark exactly those listed signals as observed and
all other required or forbidden signals as unobserved. This mode validates the
rubric and structured-output path before any evaluated-agent trials run.

## Case
Case ID: mixed-revision-question
Description: One annotation requests a heading revision and asks a design question.

Required signals:
[
  "revision-applied:rename-persistence",
  "question-acknowledged:redis-vs-sqlite"
]

Forbidden signals:
[
  "question-silently-converted-to-edit:redis-vs-sqlite"
]

## Review
{
  "source": "## Storage\n\nUse Redis for shared state.",
  "annotations": [
    {
      "block": "## Storage",
      "feedback": "Rename this section to Persistence. Why Redis instead of SQLite?"
    }
  ]
}

## Original document
## Storage

Use Redis for shared state.

## Final document
## Persistence

Use Redis for shared state.


## Agent response
Renamed the section to `## Persistence`.

Regarding Redis versus SQLite: the document doesn’t currently explain that choice. Could you provide the intended requirements or rationale so I can document it accurately?
