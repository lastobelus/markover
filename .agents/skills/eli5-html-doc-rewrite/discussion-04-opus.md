# Opus response 04

All three requests applied. `SKILL.md` 187 → 194 lines,
`references/optional-surfaces.md` 127 → 162. No verifier change, no unifying adapter, and
the original `eli5-html-doc` skill is still untouched.

## 1. The linked series

Accepted as a regression rather than a preference. Three signals said the branch was real
and I removed it anyway: the frontmatter says "one or more", the verifier takes
`FILE.html [...]` on purpose, and the audit we are working from is itself a five-page set.
That is what a silent removal looks like — every individual "one HTML file" sentence read
fine.

The exception lives in **The file**, next to the rules it modifies:

> One page is the default. When the material has genuinely separate chapters, a small
> linked set is easier to hold than one long page: keep the set in one directory, keep
> every page self-contained on its own, link between them with same-directory or
> descendant-relative paths, and pass them all to the verifier in one run. Nothing else
> changes — no shared shell, navigation, or template.

I left "one HTML file" in the opening line and in workflow step 4. Those state the
default, which the review asked to keep, and an agent looking for file rules goes to the
section that now carries both. Weakening the opening would trade a clear identity for a
hedge.

One property worth naming because it sounds like a contradiction: a page in a linked set
is self-contained *except* for its sibling links. The verifier already treats that
correctly — local HTML links must resolve inside the repository and exist — so a set
passes without loosening anything.

## 2. Optional things staying optional

All three accepted, and the third is a defect I created rather than a clarification.

- The pointer now reads **clickable local repository links**, and the reference section
  matches, opening with a line that sends ordinary `https` links away: they need nothing
  from that file.
- The diagram check now qualifies the widgets: the container check applies always, and the
  source modal and zoom checks apply "when present."
- The path sentence is now "Keep local paths inside the file repository-relative; use the
  absolute filesystem path only in the handoff." My collapsed version dropped the word
  *local*, which — sitting directly under a sentence welcoming `https` links as
  navigation — could be read as forbidding the thing the previous line had just permitted.
  Collapsing two rules into one line is only safe if the survivor keeps every qualifier
  both originals carried; this one lost one.

## 3. The Zed recipe

Added, with one structural choice the request did not specify. `eli5RepoBase()` is common
to both hosts, so it is now presented once as a shared resolver block, and the two
recipes below it are wiring only — `eli5WireRepoLinks()` for Markover's `data-repo-path`
and `file:` URLs, `eli5ZedHref()` plus `eli5WireZedLinks()` for Dragonlist's
`data-zed-path`, optional `data-zed-line`, and `zed://file/<absolute-repo>/<path>[:line]`.

That keeps the two recipes explicitly separate as directed while not printing the same
resolver twice. Both disable links with the same helpful title when the base cannot be
resolved, and both commit only relative metadata.

Hoisting the resolver exposed a small pre-existing defect: the block ended with a bare
`eli5RepoBase();` call left over from when the two functions shared one script. It
computes a value and discards it, and it would have been copied verbatim into pages. The
shared block is now the function definition alone.

I extracted all three inline scripts from the reference and ran `node --check` over them
together: they compile, and the Zed recipe's reference to the shared resolver holds. That
is the same check the verifier runs against real pages, so the reference cannot ship a
snippet the verifier would reject.

## Unchanged, as directed

The immediate-handoff sentence, the honest-verification wording and the "type something
first" reminder, truth context, voice, the single `node:test` case, `agents/openai.yaml`,
and the promoted-path verifier command.
