---
name: eli5-html-doc
description: >-
  Create one or more self-contained ELI5 HTML documents for a plan, pull request,
  implementation handoff, technical explanation, or user decision. Use when Markover
  work needs a durable local browser artifact that explains meaningful architecture,
  workflow, product tradeoffs, risks, questions, or proposed changes without requiring
  the reader to understand the full source material first.
---

# ELI5 HTML Doc

Write one HTML file that lets the user understand and answer technical work without
reading the whole diff or plan first. It is an editorial document — a short explanation
carrying the structure it actually needs — rather than an app, a dashboard, or a second
copy of the plan.

## Workflow

1. Read the repository `AGENTS.md`, then the material you are explaining, plus only the
   source, tests, plans, or design docs you need to be sure the story is true.
2. Fix the truth context: what the explanation describes, its status, where its claims
   apply, and what may change it.
3. Find the smallest useful explanation — what changed, why it matters, what stays the
   same, the decisions worth inspecting, and any question you need answered.
4. Save one self-contained `.html` file in a durable repository location.
5. Write the plain-language story first. Add cards, tables, diagrams, or controls only
   where they save the reader effort.
6. Verify the saved file, then look at it.
7. Hand off its absolute filesystem path.

Hand off the moment the page is ready. Further analysis you want to do belongs after that
link, not in front of it.

## The file

Where it lives:

- Plan explainers sit beside their plan, as `doc/plans/<date>__topic-eli5.html`.
- Design explainers sit beside their source material under `doc/design/`.
- Pull-request and implementation explainers go in the most relevant existing `doc/`
  directory. Use `docs/` only when the page is deliberately part of the public
  documentation site.

One `.html` file with inline CSS, inline JavaScript, and inline SVG. It has to open from
its saved path on a filesystem, so it carries no framework, CDN, remote asset, external
font, tracking script, build step, package, or server. Ordinary `https` links to a pull
request, issue, or plan are navigation, not dependencies, and are welcome.

Keep every local link inside the page's own directory or a descendant, and reach
repository files elsewhere through the link metadata in `optional-surfaces.md`.
Repository-relative paths inside the file; the absolute path only in the handoff. A
committed worktree path breaks for everyone but you.

One page is the default. When the material has genuinely separate chapters, a small
linked set is easier to hold than one long page: keep the set in one directory, keep every
page self-contained, and pass them all to the verifier in one run. Nothing else changes —
no shared shell, navigation, or template.

Install nothing to build or check an ELI5. When something genuinely has to run, it is
JavaScript on the repository's existing Node setup. Temporary servers and preview
processes are verification tools: stop them before handoff, and never hand out their URLs.

## What goes in it

Keep the page as small as the user's decision needs, and start with the top-level view.
Useful blocks, not a required set:

- a clear title and a one-paragraph plain-English lede
- a collapsed truth-context card when the claims can age
- `The Tiny Story`: what changed, why it matters, what does not change
- a diagram for a flow, relationship, state change, or mental model that prose leaves fuzzy
- `What This Adds` or `What This PR Changes`: concise cards or bullets
- `What Does Not Happen`: explicit non-goals, especially for tooling work
- `Important Tradeoffs` or `Risks`: only the decisions the user should inspect
- `Questions To Answer` and `What I'd Change`: rows that collect a written answer
- `References`: the plans, docs, tests, and source files you actually checked
- a compact prompt/context disclosure outside the main reading path

A title, lede, tiny story, one comparison or diagram, and a few references is a complete
ELI5 for a simple change. Do not make the page longer than its source unless the extra
structure genuinely reduces confusion or collects a decision you need.

**Diagrams, feedback controls, clickable local repository links, or icon-only buttons:**
read
[`references/optional-surfaces.md`](references/optional-surfaces.md) before building one.
It carries the layout, the wiring, and what to check for each of them.

## Truth context

When the claims can age, make a native `details` card the first thing after the lede and
immediately before the Tiny Story, and leave it collapsed. Its summary is one compact row:
a short label such as `Where This Is True` on the left, a precise state such as
`Proposed · PR 38` on the right. Applicability stays visible; the Tiny Story stays one
line away. Keep native `summary` keyboard and screen-reader behavior — restyling the
marker is fine as long as the row still looks and behaves like a disclosure.

Inside it, include the smallest set that lets a later reader judge the page correctly: the
subject and its canonical source; its status when you wrote this, such as proposed, open,
merged, or historical; the snapshot date or immutable revision when exact state matters;
the scope where the claims hold and any boundary the model leaves out; the roadmap,
milestone, or stack position when one exists; known follow-on work that may change the
picture, kept distinct from the stable center it does not touch; and where to re-check
the current truth.

Link live canonical sources for moving status and immutable ones for exact snapshots — a
date alone is not enough when a pull request, issue, or plan is the real source of truth.
Describe what may change in calibrated language: `will`, `may`, `outside this diagram`. An
open pull request or an accepted plan is never the timeless architecture of the product.

Sources move underneath finished pages. When you revisit an ELI5, re-read its named source
and correct the card. That is the whole job; nothing here stays in sync automatically, and
it should not try to.

## Prompt and context

Keep the prompt and conversation behind a small `Prompt/context` button, footer
disclosure, or modal. Curate rather than transcribe: the user's terse request, the plan or
diff being explained, the constraints that actually shaped the result, and the sources you
checked. It answers why the page exists, which is a different question from the truth
context's when and where.

## Voice

Direct language, short paragraphs, scannable structure. Aim for a serious editorial tool
with warmth, not a developer dashboard or a marketing page.

When the artifact represents Markover, follow
`doc/design/2026-08-01__brand-implementation-brief.md` and start from these light-theme
tokens:

```css
:root {
  --brand-orange: #c94e1f;
  --brand-burgundy: #6d211f;
  --ink: #26211e;
  --muted: #756d67;
  --paper: #eee8e0;
  --surface: #fffdf9;
  --line: #ddd5cc;
  --brand-soft: #f5e3da;
}
```

- Solid colors and quiet warm shadows. No gradients, glass, saturated shadows, generic
  blue focus rings, or purple palettes.
- Light mode is the baseline. Add dark or system appearance when it helps the artifact,
  and keep contrast readable in every state.
- Keep branding restrained on a working document. Omit the logo or use a small generic
  inline document favicon; do not copy path data from the canonical Markover SVGs.
- Tabs are for genuinely parallel alternatives or current-versus-proposed states. A linear
  explanation scrolls.

## Verify

Run the mechanical checks against the saved file:

```sh
node .agents/skills/eli5-html-doc/scripts/verify-eli5.mjs doc/plans/<file>-eli5.html
```

It confirms the page is self-contained, commits no absolute path, compiles its inline
JavaScript, and resolves every local link and repository-path target. Fix what it reports.

Then look at the page. Open it from its filesystem path, check it at desktop and narrow
widths, and confirm nothing overflows sideways. When the page has interactive surfaces,
`optional-surfaces.md` lists what to exercise.

Add a focused `node:test` check for a page only when it is durable product behavior
whose exact claims must stay coupled to code; most ELI5s are not that, and the existing
`jsdom` setup is there when one is.

Report what you actually did. If no rendered preview was available, run the strongest
checks you have and say once that you did not view the page. If you exercised a control,
say which one — an untested control is not a verified one.

## Hand off

Put the link near the top of your response, as a Markdown link to the real absolute
filesystem path:

```markdown
[Open ELI5](/absolute/path/doc/plans/example-eli5.html)
```

Add the repository-relative path as secondary context when it helps. Never hand off
localhost, a temporary preview URL, a signed asset URL, or an already-open tab. Confirm
the path exists and is readable immediately before you send it.

## Changing this skill

Read [`references/experiment-history.md`](references/experiment-history.md) when you are
changing this skill or evaluating a new ELI5 presentation experiment; it records which
past experiments were accepted and which were rejected. Run `npm run check` and `npm test`
before committing a change to the skill or its verifier.
