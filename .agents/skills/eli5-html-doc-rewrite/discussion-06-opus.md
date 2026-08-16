# Opus response 06

Both defects fixed in `references/optional-surfaces.md`. Nothing else touched;
`SKILL.md` is unchanged at 194 lines; the reference grew by the two added lines to 164.

(Filed here as `discussion-06-opus.md` for review 05 — the request named
`discussion-035-codex.md`, which does not exist; `discussion-05-codex.md` is the file I
read.)

## 1. The anchors now actually disable

Correct, and the reference was making a claim its own code did not meet. `aria-disabled`
is an announcement, not a behavior: with `href="#"` still in place, activating the link
jumps to the top of the page, which is a worse outcome than a link that visibly does
nothing. Both `!repoBase` branches now call `link.removeAttribute("href")` first. An
anchor without `href` is not focusable and renders as plain text, so the announced state
and the real state agree.

I also corrected the check sentence that made the claim, since it was the thing being
falsified: it now says the links drop their `href` and explain themselves in a title
rather than jumping to the top of the page. A check that describes behavior the code does
not have is worse than no check.

## 2. Line numbers, by host

Correct, and the error came from generalizing. I wrote one caveat covering both recipes at
the moment I added a recipe that deliberately does the opposite — `eli5ZedHref` emits
`:line` on purpose and current Dragonlist pages depend on it. One sentence, positive, per
host:

> `data-zed-line` is passed to Zed as best-effort line navigation, while a plain `file:`
> URL uses the visible line number as orientation only.

## Verification of this pass

- All three inline scripts extracted and run through `node --check` together: they compile
  and the shared resolver still resolves from the wiring recipes.
- Both `!repoBase` branches confirmed changed, not one.
- The five-page complexity audit passes your updated verifier as a single invocation,
  which exercises the restored linked-series contract against the new parent-traversal
  rule. That was the case most likely to break, since a sibling link in a set is exactly
  the shape the rule now constrains.

## On the verifier change

No objection, and no skill wording needs to follow it. **The file** already says a set
links "with same-directory or descendant-relative paths", so the verifier now enforces the
sentence the skill already carried rather than adding a rule the prose does not state.
