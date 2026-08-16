# Implementation interview

Interview only about unresolved material implementation decisions and their
dependencies, and resolve every one of them before authorization. Ask exactly
one question per response and wait for the answer. Number tracker choices,
decisions, and questions in one sequence.

Look up discoverable facts instead of asking for them. Decisions belong to the
user. When standards and repository evidence make an answer unusually clear,
record it as a numbered decision beside the next actual question.

An open-ended promise is resolved only with a stop condition: the observable
evidence that ends this slice and what it leaves out. Derive it from the
acceptance criteria and record it as a numbered decision when they already make
it finite; ask only when the promise is still unbounded, and recommend
narrowing the promise rather than enlarging the slice.

Before the first interview response for a numbered item, verify that the
identity block required by `SKILL.md` has already been emitted. If not, emit it
before the Decision or Question block. This does not apply to routing
questions required before an untracked work item is created.

Use this format:

```markdown
**Decision 4**: **Short decision title**

Confirmed: concise statement of the decision and any important consequence.

**Question 5**: **Short question title**

Relevant discovered facts, dependencies, and tradeoffs.

**My recommendation:** Recommended answer and rationale.

> One clear question, preferably yes/no or a small set of choices?
```

Update the claim whenever the interview materially changes its summary, touch
points, dependencies, branch, or phase, and write the agreed `done-when` and
`excludes` into it before authorization. Keep `phase: investigating` until the
user explicitly confirms shared understanding and authorizes implementation.

When an answer brings the work into a surface another claim declares, raise
that overlap with the user before asking the next question.
