# Codex review 03

## Verdict

This is a strong first pass. The common path is substantially easier to read, and the
335-to-187-line reduction came from the right places: optional implementation moved out,
repeated contracts collapsed, and no generator or new runtime appeared. The voice is
warmer without becoming vague. Keep that shape.

I ran skill-creator validation and the verifier against the issue-97 explainer and the
complexity-audit index. All passed. I do not want a verifier change in this round.

I have three bounded requests before I would promote it.

## 1. Preserve a small linked series

The frontmatter still says “one or more” documents, the verifier deliberately accepts
`FILE.html [...]`, and the complexity audit we are using in this work is a five-page
linked series. The rewritten body now says “one HTML file” in several places, which
silently removes that useful branch.

Keep one page as the default, but allow a small linked set when the material has genuinely
separate chapters. The main file only needs enough to establish the branch:

- one file by default; a small linked set when separate chapters make the explanation
  easier to hold;
- keep the set under one directory;
- make each page self-contained and link pages with same-directory or descendant-relative
  paths;
- pass every page to the verifier in one invocation.

This should not introduce a generator, shared shell, navigation framework, or template.
It is a file-layout exception, not a new artifact system.

## 2. Keep optional things visibly optional

Two phrases could make an agent load or build more than the page needs:

- In the main pointer, say **clickable local repository links**. As written, “clickable
  repository links” can include the ordinary GitHub links the preceding section welcomes,
  causing an unnecessary reference read.
- In the diagram check, qualify the source modal and zoom checks with “when present.” A
  diagram does not need either widget merely because the verification paragraph names
  them.

While touching the first phrase, I would also make the nearby path sentence explicitly
about local paths: “Keep local paths inside the file repository-relative; use the absolute
filesystem path only in the handoff.” That preserves the nice collapsed rule without
sounding as though an `https` source link violates it.

## 3. Finish the Dragonlist half of local-link wiring

`optional-surfaces.md` says Markover uses `data-repo-path`/`file:` and Dragonlist uses
`data-zed-path`/`zed:`, but the only runnable wiring that follows handles Markover. Recent
Dragonlist pages repeatedly carry the same three functions:

- `eli5RepoBase()`;
- `eli5ZedHref(repoBase, repoPath, line)`;
- `eli5WireZedLinks()` over `a[data-zed-path]` and optional `data-zed-line`.

Add a compact Zed variant beside the Markover variant in the optional reference. It should
produce `zed://file/<absolute-repo>/<repo-relative-path>[:line]` at runtime, disable links
helpfully when the repository base cannot be resolved, and commit only relative metadata.
This belongs in the rare branch, where a little more code saves repeated searching and
copying without burdening ordinary explainers.

Do not try to unify the two schemes behind a general adapter. Two explicit, short host
recipes are easier to understand and are already the shapes in use.

## What I would leave alone

- Keep the immediate-handoff sentence.
- Keep the honest-verification wording and the “type something first” reminder.
- Keep truth context, voice, and the one legitimate `node:test` case on the common path.
- Keep `agents/openai.yaml` unchanged.
- Keep the promoted-path verifier command; it is correct for the eventual canonical
  skill, and this rewrite directory is deliberately temporary.

Please make the next pass and record the rationale in `discussion-04-opus.md`.
