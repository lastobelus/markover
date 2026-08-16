# Fable review 08

This is the best-executed of the three skill rewrites, and it is ready to
promote. It was also a different exercise from start-issue and babysit — those
were rescues of accreted machinery; this was compression of a skill that was
already working — and the thread handled that correctly: nothing
user-validated was lost, the one real regression was caught and named as a
regression, and the only additions are two one-sentence rules each backed by a
specific transcript failure. Three findings below, all small; none blocks
promotion.

## What holds up

**The brief is the strongest document in the set.** Every structural decision
is grounded in corpus counts — 30 pages, all self-contained, all carrying
`data-repo-doc-path`, but only 2–8 pages using any given optional surface —
which makes the common/optional split an empirical fact rather than a taste
call. The two refusals rest on the same footing: 71 unique normalized style
blocks among 72 means presentation genuinely is not stable enough to template,
and the churn evidence pointed at retyped mechanical checks, not page
generation. The verifier is the one automation the evidence supported, and it
is well scoped: explicit files only, mechanical contract only, deliberately
refusing the truth judgment a script cannot make.

**Two de-duplication moves worth reusing in future rewrites.** Deleting the
prose copy of the mechanical checklist because the script is the source of
truth and a prose copy would go stale silently; and discussion 04's rule that
collapsing two sentences into one is only safe when the survivor keeps every
qualifier both originals carried — which is exactly how the "local paths"
qualifier was lost and recovered.

**The moving-truth paragraph is a small gem.** "Re-read its named source and
correct the card. That is the whole job; nothing here stays in sync
automatically, and it should not try to." The complexity-accretion lesson as
nine words of scope refusal — no truth-context updater, no PR-inventory
generator, no fixed-point dashboard.

**The thread caught defects, not preferences.** The silent linked-series
removal, where three signals contradicted the rewrite (frontmatter, verifier
arity, the five-page audit itself) and Opus named its own failure mode —
"every individual 'one HTML file' sentence read fine." The
`aria-disabled` anchor that still navigated to the top of the page. The
line-number caveat contradicting the Zed recipe added in the same pass. The
leftover bare `eli5RepoBase();` call that would have been copied verbatim into
real pages.

**Verified in this pass:** `references/experiment-history.md` and
`agents/openai.yaml` are byte-identical to the originals as claimed; both
`!repoBase` branches drop `href`; the new issue-97 explainer passes the
verifier; and the full 14-page committed Markover corpus passes the rewritten
verifier with the single known failure — the stale `docs/releasing.md`
reference in the signing slice-3 explainer, which the brief already reported
and correctly left out of scope.

## Three findings

### 1. The parent-traversal rule is broader than the prose that justifies it

Discussion 06 says the verifier "enforces the sentence the skill already
carried," but that sentence in **The file** is scoped to linked sets — "link
between *them* with same-directory or descendant-relative paths" — while
`verify-eli5.mjs` rejects a `..` segment in every local href on every page.

The rule matches Markover reality: all 14 committed pages pass it, checked in
this review. But the 16 Dragonlist pages were never re-checked after the rule
tightened; discussion 05 verified "both representative real pages" only. Two
cheap closures: state the general rule once in **The file** (local links are
same-directory or descendant; anything else is reached through
`data-repo-path` metadata), and run the verifier over the Dragonlist corpus
before treating it as that project's shared contract.

### 2. Promotion carries a mechanical step the discussions only imply

The Verify command points at
`.agents/skills/eli5-html-doc/scripts/verify-eli5.mjs`, and the canonical
directory currently has no `scripts/` at all. Promotion is therefore not
"replace SKILL.md": it must copy `scripts/`, add
`references/optional-surfaces.md`, keep `references/experiment-history.md`,
and delete the discussion files, this one included. Discussion 02 flagged the
path as promoted-correct on purpose; the missing piece is only that the
promotion itself has a checklist, so the command does not dangle.

### 3. A micro-instance of the execution-order class, created in reverse

Workflow step 1 reads "Read the material you are explaining… Read the
repository `AGENTS.md` first." The rule saying *first* arrives last — the
rule-after-the-action shape the start-issue and babysit threads caught five
times between them, in miniature. The original skill had `AGENTS.md` first in
sentence order; the rewrite reversed it and patched the reversal with the word
"first." Harmless in practice, one-clause reorder to fix.

## Edge cases deliberately not reported

The verifier would mis-handle a JSON-LD `<script type="application/ld+json">`
block (the JS compile check would reject it) and would fail a committed
literal `zed:` href with a confusing does-not-exist message. Neither shape
exists anywhere in the corpus, both fail closed, and hardening a verifier
against inputs no page has ever produced is the accretion pattern this
repository is working to stop. Recorded here only so a future maintainer who
hits one knows it was seen and declined, not missed.

## A norm worth keeping from all three threads

The closing states were honest in a way that should stay the standard:
discussion 06 here correcting a misnamed file reference instead of silently
resolving it; babysit's discussion 04 declining to claim a validation it had
not run because `quick_validate.py` exists nowhere in the repository; and the
verifier's first corpus run surfacing a real stale link in an old artifact and
leaving it unfixed as out of scope. Skills that encode honest reporting were
themselves reviewed honestly.
