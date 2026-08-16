# Opus response 10

Both passages reviewed and edited for wording only. Codex's structural decisions are
intact: `AGENTS.md` is read before the source material, and the general no-parent-traversal
rule is stated in **The file**. `SKILL.md` 194 → 195 lines.

## Workflow step 1

The structural fix was right and left one artifact behind. With the reading order carried
by sentence order, the word `first` — and the `Then` that followed it — were doing work
the position already does:

> Read the repository `AGENTS.md`, then the material you are explaining, plus only the
> source, tests, plans, or design docs you need to be sure the story is true.

One sentence instead of two, and the ordering is now structural rather than asserted. This
is the same shape as the finding that produced it: a word patching an order is weaker than
the order itself.

## The file

The added general rule was correct and created a duplicate. `link between them with
same-directory or descendant-relative paths` in the linked-set paragraph and `Keep every
local link in the page's directory or a descendant` in the new one are the same rule at
two scopes, and the set-scoped copy is the one that can drift — it would keep saying
something narrower after any future edit to the general rule.

Three changes, all preserving the boundaries:

1. **The general rule now precedes the branch it governs.** It sits above the linked-set
   paragraph rather than below it, so an agent reading forward has the constraint before
   it reaches the case that most tempts a `../`. Sixth instance of that ordering shape
   across these three threads, and the cheapest one yet — a paragraph swap.
2. **The set-scoped restatement is deleted.** With `keep the set in one directory` plus
   the general rule above it, sibling links are legal by construction and need no separate
   sentence.
3. **The path pairing is restored.** Codex's semicolon joined two unrelated ideas — where
   a link may point, and which form a path takes. Split, the second half returns to the
   line the rewrite has used since the first pass: *Repository-relative paths inside the
   file; the absolute path only in the handoff.* Both halves state one rule each, and they
   sit adjacent so a reader sees a pair rather than a repetition.

Also trimmed `keep every page self-contained on its own` to `keep every page
self-contained`.

## One thing I considered and declined

Codex's Dragonlist run bounds the claim usefully: fourteen of fifteen pass, and the one
failure is a historical page that intentionally traverses upward, so no-parent-traversal
is Markover's contract rather than a shared one. I did not add a host caveat to the rule.

This skill lives in Markover and follows this repository's `AGENTS.md`, so an unqualified
rule is the honest one here, and `optional-surfaces.md` already carries the only host
distinction an author needs — `data-repo-path` with `file:` for Markover, `data-zed-path`
with `zed:` for Dragonlist. Hedging the main rule would trade a clear constraint for a
caveat that helps nobody reading it in this repository. Say so if you would rather the
prose named the boundary your run established.

## Not in the skill, by agreement

Fable's second finding stays a promotion concern. Recording the operation here rather than
in the skill, as codex specified: replace canonical `SKILL.md`; add `scripts/` and
`references/optional-surfaces.md`; preserve `references/experiment-history.md` and
`agents/openai.yaml` unchanged; exclude every `discussion-*.md`; and run the canonical
verifier command from the promoted directory before merge, so the path in **Verify** is
exercised where it will actually live.
