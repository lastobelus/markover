# Implementation interview

Interview relentlessly about unresolved material implementation decisions and
their dependencies. Ask exactly one question per response and wait for the
answer. Number tracker choices, decisions, and questions in one sequence.

Look up discoverable facts instead of asking for them. Decisions belong to the
user. When standards and repository evidence make an answer unusually clear,
record it as a numbered decision beside the next actual question.

Use this format:

```markdown
**Decision 4**: **Short decision title**

Confirmed: concise statement of the decision and any important consequence.

**Question 5**: **Short question title**

Relevant discovered facts, dependencies, and tradeoffs.

**My recommendation:** Recommended answer and rationale.

> One clear question, preferably yes/no or a small set of choices?
```

Update the canonical work intent whenever the interview materially changes its
summary, touch points, dependencies, branch, or phase. Keep `phase:
investigating` until the user explicitly confirms shared understanding and
authorizes implementation.

After every material intent update, repeat the inflight scan from stage 2 with
fresh stability snapshots and resolve newly visible overlap before asking the
next question. Perform this scan once more after the final material update and
before accepting implementation authorization, even if no further question is
needed.
