# Opus rewrite 02

`SKILL.md` 335 → 187 lines, with one new reference at 127. The common path is the whole
main file: an agent writing an ordinary explainer — title, lede, truth card, tiny story,
references — opens nothing else.

Nothing was added that the brief declined. No generator, template, dependency, background
process, persistence, or compatibility prose.

## Where the 148 lines went

Roughly a third moved and roughly two thirds were duplicates.

**Moved to `references/optional-surfaces.md`** — diagrams, feedback controls and the copy
script, clickable repository links with their runtime wiring, and icon-only controls. Each
section ends with what to check once the surface exists, which is why this is one
reference rather than two.

I considered the brief's alternative of a separate visual-verification reference and
decided against it. The checks are not a coherent body on their own: "zoom keeps the left
edge reachable" is only meaningful beside the rule that created the zoom levels. Splitting
them would produce two pointers with the same trigger — *this page has a diagram* — which
is the vaguer outcome, not the sharper one. The main file keeps the one check that applies
to every page: it reads well and does not overflow sideways at desktop and narrow widths.

**Deleted as duplication.** The durable-path rule appeared three times, the no-runtime
rule four, prompt/context three, and jsdom twice. Each is now stated once, in the place
that owns it.

Two of those collapses are worth naming because they were hiding a real distinction:

- The path rules read as one repeated idea but are two complementary ones. They are now a
  single line — *repository-relative paths inside the file; the absolute path only in the
  handoff* — which says both and cannot drift apart.
- The old Verification section listed the mechanical properties the verifier now checks.
  That list is deleted rather than paraphrased: the script is the source of truth for the
  mechanical contract, and a prose copy of it would go stale silently.

## The verifier

Wired into the Verify section as a concrete command, run against the saved file before
anything visual:

```sh
node .agents/skills/eli5-html-doc/scripts/verify-eli5.mjs doc/plans/<file>-eli5.html
```

I ran it against two current Markover pages while writing this; both pass, and its
`PASS`/`FAIL` output needs no explanation in the skill.

**One note on the path.** The command names the promoted location, not this rewrite
directory, so it is correct after promotion and wrong before it. The alternative — writing
the `-rewrite` path — ships a command that has to be edited at promotion, which is worse.
Flagging rather than hedging.

No change requested to the script. Its scope matches what the skill now claims, and the
one judgment it deliberately refuses — whether the prose is still true — is exactly what
the truth-context rule hands to the agent instead.

## The behaviors the brief said must survive

Present and, where possible, on the common path: one durable self-contained file; the
plain-language story before technical detail; editorial rather than app; visual structure
only where it earns its place; the collapsed truth-context card in its deliberate position
after the lede and before the Tiny Story; truthful local and canonical references; the
absolute-path handoff; light-first Markover styling with restrained branding; and the rule
that an ELI5 is not a second comprehensive plan.

Two small pieces I pulled back after a first pass dropped them, both from accepted
experiment loops: the distinction between the explanation's stable center and the
follow-on work that may move its details, and the single legitimate case for a coupled
`node:test` check — a page that is durable product behavior whose exact claims must track
code. Most ELI5s are not that, which is why it is one sentence rather than a section.

## The two behavioral additions

Both come from failures in the brief's evidence, and both are one sentence.

**Handoff timing.** "Hand off the moment the page is ready. Further analysis you want to
do belongs after that link, not in front of it." This is the PR 141 thread, where the
finished ELI5 sat behind wandering analysis until the user asked *where's my eli5?* It sits
directly under the workflow rather than in the handoff section, because the failure
happens between steps 6 and 7, not at step 7.

**Honest verification.** "Report what you actually did… an untested control is not a
verified one," and the reminder in the feedback section to type something in before
testing the copy button. That is the Dragonlist thread where an agent clicked Copy Answers
on an empty form and overstated the result.

## Judgment calls open to you

1. **Prohibitions dropped in favor of positive rules.** "Do not add Python, Ruby, shell,
   or another language" became "Install nothing to build or check an ELI5. When something
   genuinely has to run, it is JavaScript on the repository's existing Node setup." Naming
   the forbidden languages makes them more available, not less. If a live run reaches for
   a shell script, the prohibition earns its way back.
2. **The content list lost its feedback entries.** Approve/reject controls and the sticky
   copy button are now only in the reference, so a reader scanning the menu of blocks will
   not see them. The pointer immediately below the list names feedback controls as a
   branch, which I judged sufficient — but it is the one place disclosure costs
   discoverability.
3. **`agents/openai.yaml` is unchanged.** Its short description and default prompt still
   describe the behavior accurately, including the truth-context card, so editing it would
   be churn.
4. **Section ordering.** Truth context now comes before Voice and after the content list,
   following the order an author actually works in. The original interleaved judgment and
   implementation sections; nothing about that order was load-bearing that I could find.
