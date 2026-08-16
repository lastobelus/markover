# ELI5 HTML skill rewrite: evidence and first brief

## What we are doing

The user likes this skill. It has worked well in Markover and Dragonlist, and there is
no evidence that it caused the complexity-accretion problems we have been studying.
This is a careful edit, not a rescue.

Our division of work is:

- Opus owns the prose rewrite: clearer, warmer, easier to hold in your head.
- Codex owns the evidence, scripts, context-size decisions, and review of each pass.

The goals are to preserve the results, give the instructions the Opus “vibe,” reduce
churn, and keep uncommon branches out of the always-loaded `SKILL.md`.

Before this pass I read the original skill, its experiment history, the repository's
writing-for-agents guidance, and Codex's skill-creator guidance. Five Luna agents then
audited the skill structure, current artifacts, project tooling, and actual Markover and
Dragonlist sessions. Dragonlist evidence was limited to 10 July–14 August 2026, as
requested.

The rewrite directory began as an exact copy of the original. The original
`.agents/skills/eli5-html-doc/` remains untouched.

## The short version

The skill's judgment is good. Its information architecture is not.

Keep the common authoring path in `SKILL.md`. Move diagrams and zoom, feedback controls,
repo-link implementations, and detailed visual checks into one or two references that
are read only when those features are actually present. Keep experiment history separate.

Do not create a page generator or a common visual template. The successful artifacts are
usefully different. The repeated work worth automating is mechanical verification, so I
added `scripts/verify-eli5.mjs`.

## What is working and must survive

The strongest direct feedback was on the Electron-boundary explainer: the user called it
“perfect.” The signing/notarization bundle was also explicitly approved. Markover ELI5s
have worked as durable companions to plans, implementation handoffs, and Markover review
rounds.

The successful center is:

- one durable, self-contained HTML artifact;
- a small plain-language story before technical detail;
- an editorial document, not a fake app or generic dashboard;
- visual structure only where it reduces reading or decision effort;
- a compact, collapsed truth-context card for claims that can age;
- truthful local and canonical references;
- an absolute filesystem-path handoff that survives preview and sleep/wake failures.

The truth-context addition was learned through use and should remain on the common path.
It prevents proposed or branch-specific architecture from looking timeless. Its current
placement—after the lede, before the Tiny Story—was a deliberate user preference.

Likewise, preserve the light-first Markover styling, compactness, restrained branding,
accessible controls, and the rule that the ELI5 should not become a second comprehensive
plan.

## What the corpus says is common

There are 14 current Markover ELI5 pages and 16 extant Dragonlist pages touched during
the bounded five-week window.

Across all 30:

- all are self-contained HTML with inline CSS;
- all carry `data-repo-doc-path`;
- none depends on an external script, stylesheet, font, or CDN;
- none contains a committed absolute worktree path;
- all 16 Dragonlist pages and 13 of 14 Markover pages contain inline JavaScript;
- repo-local references are common in both projects, although Markover uses
  `data-repo-path`/`file:` and Dragonlist uses `data-zed-path`/`zed:`.

This is a stable mechanical contract. It belongs in the main skill and the verifier.

The presentation is not stable enough to template. Every Markover style block is unique;
Dragonlist has 71 unique normalized style blocks among 72 style blocks. Shared names such
as `card`, `grid`, and `flow` describe ideas, not a CSS system.

## What is actually optional

In the 16 recent Dragonlist pages:

- 8 use `details`;
- 2 contain SVG diagrams;
- 2 collect feedback in textareas;
- 3 contain clipboard behavior;
- 5 support dark mode.

In the 14 current Markover pages:

- 8 contain SVG;
- 1 contains feedback textareas;
- 13 use repo-link metadata;
- the five-page complexity audit does not need feedback controls or elaborate diagrams.

The current 335-line skill makes every invocation read the implementation details for
all of these branches. The clearest material to disclose is:

- diagram layout, source display, zoom levels, and pinned controls;
- feedback rows, approve/reject state, clipboard fallback, and copied Markdown shape;
- icon-only control rules;
- project-specific local-link wiring examples;
- detailed DOM, keyboard, narrow-width, zoom, modal, and feedback verification.

One `references/optional-surfaces.md` may be enough for the first four. A separate concise
visual-verification reference is reasonable if combining it would make the branch pointer
vague. Please do not split the skill into a forest of tiny references.

Keep `references/experiment-history.md` as the rare maintenance-only branch it already is.

## Where the churn really came from

### Repeated mechanical checks

Agents repeatedly retyped some combination of:

- `rg` scans for external assets, absolute paths, stale headings, and local-link metadata;
- ad hoc Node or jsdom programs to parse the page and inspect controls;
- extraction of inline JavaScript followed by `node --check`;
- recursive checks of every local `href` and `src`;
- desktop and narrow browser checks;
- temporary one-line Node HTTP servers when direct filesystem preview failed.

Markover has two artifact-specific test files that repeat pieces of this contract.
Dragonlist has no common ELI5 verifier and records the same ad hoc commands in several
threads.

### Moving truth

Several ELI5s changed because their source changed underneath them:

- a signing page and its exact-text test drifted when local work became a draft PR;
- Dragonlist review dashboards were revised as new cycles and PRs appeared;
- one retrospective went from 12 PRs to 13 to 14 during inventory;
- multiple pages overstated a draft plan or stale baseline as settled truth.

That is not a formatting problem. A script cannot decide whether a claim is still true.
The skill should tell the agent to re-read the named source and keep the truth card honest,
then stop. Do not build a truth-context updater, PR-inventory generator, or fixed-point
dashboard system into this skill.

### Fragile preview machinery

Actual sessions contain repeated “no browser,” snapshot, click, filesystem-navigation,
and viewport-resize failures. Agents often fell back to a local server. In one Dragonlist
thread an agent clicked Copy Answers without entering text and then overstated what had
been verified.

This argues for separating deterministic verification from best-effort rendered QA. It
does not yet justify a server/process manager inside the skill. Such a helper would still
need the host-specific preview tools, lifecycle cleanup, port handling, and honest reports
of what automation actually did. Keep the fallback short and conditional in a reference.

### Delayed handoff

In the PR 141 thread the requested ELI5 had already been written, but analysis wandered
into threat modelling until the user asked, “where's my eli5?” The workflow should hand
off the artifact as soon as the promised page is ready. Optional follow-up analysis must
not hide the deliverable.

## Script added by Codex

`scripts/verify-eli5.mjs` is a dependency-free, read-only verifier. Run it with explicit
inputs:

```sh
node .agents/skills/eli5-html-doc-rewrite/scripts/verify-eli5.mjs path/to/page.html [...]
```

It checks only the mechanical contract:

- the file exists and has the basic HTML shell;
- `data-repo-doc-path` agrees with the saved path when present;
- no external runtime script, stylesheet, CSS import, font, image, or media dependency;
- no committed user-home path or literal absolute file URL;
- inline JavaScript compiles;
- local HTML links and `data-repo-path`/`data-zed-path` targets stay inside the repository
  and exist.

It deliberately takes explicit files rather than scanning every HTML file in a repo. It
does not require a Tiny Story, truth card, diagram, feedback form, theme, or fixed section
set. It does not judge whether prose is true.

Corpus result:

- all 16 recent Dragonlist pages pass;
- 13 of 14 current Markover pages pass;
- the remaining Markover page has a real stale reference to the nonexistent
  `docs/releasing.md` in the signing slice-3 explainer.

The old artifact was not changed. Finding a cheap, recoverable stale link is the intended
kind of result.

Please wire the verifier into the rewritten workflow. Its path should be relative to this
skill directory, so the agent can run the copy that came with the skill. Keep visual QA
separate and conditional.

## Recommended shape of the rewrite

The primary `SKILL.md` should still contain:

1. what the skill produces and when it applies;
2. the short workflow from reading source to immediate handoff;
3. location and durable-path rules;
4. the self-contained/no-runtime-dependency contract;
5. the small-content rule and likely content shapes;
6. truth context, because it is common judgment rather than an optional widget;
7. the Markover voice and light-theme center;
8. the verifier command and a short rendered-QA requirement;
9. the durable absolute-path handoff.

Please collapse repeated meanings. At present the durable-path rule appears in the
workflow, file-location section, and handoff; the no-runtime rule appears in the stack,
references, verification, and handoff; prompt/context separation appears in three places;
and jsdom guidance appears twice.

Do not preserve repetition merely by paraphrasing it. Keep one source of truth and one
late checkpoint only where the reminder prevents a demonstrated handoff failure.

There is no target line count. A substantial reduction should fall out naturally from
moving conditional implementation details and deleting duplicate rules. Do not achieve a
smaller file by making the remaining language denser or more legalistic.

## Things I recommend we decline

- A generator, scaffolder, shared CSS system, or required section template.
- A universal `--all` scan across public docs, prototypes, and ELI5 pages.
- Mandatory truth cards or Tiny Stories for historical/simple artifacts that do not need
  them; retain the existing moving-truth trigger.
- Semantic assertions in the generic verifier.
- Artifact-specific contract tests by default. Keep those only when the page itself is
  durable product behavior whose exact claims must remain coupled to code.
- Mandatory Playwright, Chrome, Mermaid, jsdom, or new dependencies.
- A preview server manager in this pass.
- Compatibility prose for old skill layouts. This copy has not shipped independently.

## Acceptance test for Opus's pass

The rewrite is ready for review when:

- an agent can follow the common path without opening an optional reference;
- each optional branch has one clear trigger that names when to read it;
- every user-validated behavior above still has an obvious home;
- the verifier is used for mechanical checks, with rendered QA described honestly as a
  separate best-effort step;
- the handoff happens immediately after the requested artifact is ready;
- the prose is easier and more inviting to read, not merely shorter;
- `agents/openai.yaml` still describes the resulting behavior accurately;
- no generator, dependency, background process, persistence, or compatibility layer was
  introduced.

Please make the first rewrite pass in this directory and add your rationale as
`discussion-02-opus.md`. Do not change the original `eli5-html-doc` skill. If you think
the verifier itself should change, explain why in the discussion rather than broadening it
silently; Codex owns that script and will make the adjustment.
