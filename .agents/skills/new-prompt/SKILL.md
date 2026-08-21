---
name: new-prompt
description: Write ready-to-paste prompts that transfer a thread's unique context to another agent. Use when asked to draft, improve, or hand off a prompt for a fresh agent, subagent, restarted thread, or different environment; produce the prompt without executing it.
---

# New Prompt

Write a **context delta**, not a recap. The receiving agent gets its own
startup instructions and can inspect the environment available to it. Spend
the prompt on what changed, emerged, or was decided during this thread and
would otherwise disappear with it.

## Draw the context boundary

Determine what the recipient will receive independently of the prompt:

- system, global, repository, and directory guidance loaded at startup;
- forked conversation turns or supplied attachments;
- the current checkout, files, Git history, issue tracker, logs, and other
  durable sources the recipient can inspect;
- differences in machine, checkout, permissions, tools, or available sources.

Treat the first three as the **baseline** wherever they are available to the
recipient. A target-environment difference is part of the delta. When the
delivery mechanism leaves the boundary uncertain, state the necessary
environment assumption briefly instead of copying possible baseline material.

## Account for the sources

Classify candidate content before drafting:

- **Baseline:** inherited guidance and facts cheaply recoverable from the
  recipient's environment. Rely on them.
- **Durable thread artifact:** a plan, diff, commit, issue, log, or report made
  or selected during the thread. Point to its exact location and say what role
  it plays.
- **Thread delta:** user refinements, decisions and rationale, costly
  discoveries, surprises, failed attempts and observed results, scoped
  overrides, unresolved questions, and the exact continuation point. Carry
  these into the prompt.
- **Snapshot:** branch, test, CI, process, service, or other live state that can
  go stale. Include its observation source or time when useful and tell the
  recipient what narrow fact to recheck.

A candidate earns space when omitting it would make the recipient repeat an
investigation, repeat a failed attempt, ask the user an already-settled
question, or make a materially different decision. If the recipient can
recover it cheaply, omit it or replace it with a purposeful pointer.

## Compose the prompt

Front-load the recipient's exact job, expected artifact or answer, current
continuation point, scope, and checkable completion condition. Then provide the
thread delta in the order that supports the work:

- settled user decisions, including the rationale when it prevents
  re-litigation;
- observations and discoveries, with enough evidence to trust or reproduce
  them;
- attempted actions and their exact results, especially plausible paths that
  failed;
- current state and unfinished work;
- hypotheses and open questions, clearly distinguished from requirements;
- durable pointers needed to continue, each with a short statement of purpose;
- the first useful next action when the investigation already established one.

Preserve causality rather than chronology: symptom, evidence, attempt, result,
and resulting decision are more useful than a turn-by-turn diary. Preserve
exact user wording only when its nuance controls a decision or boundary.

Use authority labels such as `Settled`, `Observed`, `Attempted`, `Hypothesis`,
`Open`, and `Snapshot — recheck` when prose alone could blur their status. An
agent suggestion remains a hypothesis until the user or authoritative evidence
adopts it.

For a scoped override to baseline guidance, include the conflicting rule by
reference, the replacement behavior, why it applies, its scope, and when it
expires. This is a delta, unlike general emphasis of the baseline.

Use exact file paths, symbols, commit or review IDs, and semantic locator
commands where they save archaeology. For unstable timestamped or generated
paths, give a stable query or identifying property rather than relying on one
fragile literal path. Keep credentials, secrets, irrelevant raw output, and
private data outside the prompt.

## Prune and deliver

Every substantive sentence in the finished prompt should serve the task,
thread delta, target-environment difference, purposeful pointer, or completion
condition. Remove:

- quotations or paraphrases of guidance the recipient receives at startup;
- summaries of source files the recipient can read, except the thread-specific
  reason a source matters;
- generic method, safety, verification, and reporting reminders that do not
  change this task;
- repeated instructions included only for emphasis;
- unsupported implementation prescriptions presented as settled decisions.

When the thread produced little or no meaningful delta, return a short task,
deliverable, pointer, and done condition rather than padding the prompt with
repository background.

Return only the ready-to-paste prompt unless the user asks for commentary,
variants, or a saved artifact. Writing a prompt authorizes writing the prompt;
run it, spawn its recipient, or begin its task only when the user explicitly
asks for that action.
