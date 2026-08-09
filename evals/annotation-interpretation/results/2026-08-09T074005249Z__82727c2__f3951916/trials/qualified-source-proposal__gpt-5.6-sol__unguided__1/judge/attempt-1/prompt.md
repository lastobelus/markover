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

## Case
Case ID: qualified-source-proposal
Description: An exact proposal is accompanied by a question that makes its intent contextual.

Required signals:
[
  "proposal-considered:five-retries",
  "question-acknowledged:upstream-overload"
]

Forbidden signals:
[
  "question-silently-converted-to-edit:upstream-overload"
]

## Review
{
  "source": "Retries: 3",
  "annotations": [
    {
      "block": "Retries: 3",
      "feedback": "Would five retries overload the upstream service?",
      "sourceEdit": {
        "original": "Retries: 3",
        "current": "Retries: 5"
      }
    }
  ]
}

## Original document
Retries: 3

## Final document
Status: regular
Retries: 3

## Agent response
Five retries could increase upstream load, but the document provides no capacity or rate-limit data to establish whether it would overload the service. I left the retry count at three pending that validation.
