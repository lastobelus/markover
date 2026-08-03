# Annotation intent guidance

## Problem

When a user annotates a document in Markover, they may move fluidly between
suggesting revisions and asking questions for clarification, deeper
explanation, or discussion.

Without explicit guidance, agents tend to treat every annotation as an edit
instruction and fold both kinds indiscriminately into the next version of the
document. That loses the conversational intent of questions and other
meta-level feedback.

## Desired agent behavior

After the user asks an agent to "check Markover," the agent should interpret
each annotation according to its intent:

- Fold requested revisions into the next version of the document.
- Answer questions and engage with discussion in the agent thread.
- Use the surrounding document and annotation context when the intent is
  ambiguous instead of assuming that every comment requests a rewrite.

This distinction is about the requested response, not a rigid annotation type
that users must select before writing feedback. Users should remain free to
mix revisions, questions, and discussion naturally within a review.

## Guidance delivery

Discuss whether Markover should provide a short preamble alongside returned
review data, include the guidance in its agent-facing usage instructions, or do
both. The choice should account for how reliably agents see the guidance at the
moment they interpret review JSON without adding enough repeated text to
obscure the annotations themselves.

No delivery approach is selected in this plan. The pull request is the place
to resolve that decision before implementation begins.

## Skill decision

Decide whether Markover should also ship a skill that teaches agents the
review workflow and the revision-versus-meta distinction. The discussion
should establish what a skill would add beyond inline preamble or usage
instructions, how users would discover it, and whether behavior would remain
reliable when the skill is absent.

## Examples to collect

Mine real Markover usage for concise examples that make the distinction clear.
The example set should cover at least:

- A direct requested revision that belongs in the next document version.
- A clarification question that should receive an answer in the thread.
- A request for deeper explanation that may lead to discussion before any
  document edit.
- A mixed or ambiguous annotation where the agent should preserve the
  distinction rather than converting the whole comment into prose.

Examples must be reviewed for sensitive or project-specific context before
being included in guidance or eval fixtures.

## Evaluation plan

Set up agent evals using representative Markover JSON and the collected sample
annotations. Compare candidate guidance approaches and verify that agents:

1. Apply requested revisions to the document.
2. Answer questions and respond to discussion in the thread.
3. Handle a mixture of both behaviors in one review.
4. Avoid inventing edits in response to purely meta annotations.
5. Preserve unresolved ambiguity for discussion instead of silently choosing
   an interpretation.

Define the fixture set, scoring rubric, agent/model matrix, and an acceptable
success threshold during the PR discussion. Keep baseline runs without the new
guidance so its effect can be measured.

## Open decisions

- [ ] Discuss whether a short preamble or usage-instruction guidance is better,
  or decide to do both.
- [ ] Decide whether to also ship a skill.
- [ ] Mine real Markover usage for clear examples of revision versus meta
  annotations to include in the guidance.
- [ ] Set up and run evals with agents and sample Markover JSON to test whether
  the guidance is effective.

## Scope of this pull request

This pull request starts and hosts the discussion. Its initial commit contains
only this plan. It intentionally does not implement guidance, add a skill,
collect examples into product-facing material, or add eval infrastructure.
Implementation should begin only after the open decisions have been discussed.
