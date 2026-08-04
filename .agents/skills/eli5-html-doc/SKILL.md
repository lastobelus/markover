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

Create a compact, self-contained HTML file that lets the user understand and respond to
technical work without reading the whole diff or plan first.

Read `references/experiment-history.md` only when changing this skill or evaluating a
new ELI5 presentation experiment.

## Workflow

1. Read the repository `AGENTS.md`, the material to explain, and only the related source,
   tests, plans, or design references needed to verify the story.
2. Establish the truth context: what artifact or state the explanation describes, its
   status and roadmap position, where its claims apply, which parts are expected to
   remain stable, and which known work may change or supersede them.
3. Identify the smallest useful explanation: the change, why it matters, what remains
   unchanged, the decisions or risks that deserve attention, and any questions the user
   must answer.
4. Choose a durable repository location and create one self-contained `.html` file.
5. Write plain-language content first. Add cards, tables, diagrams, or controls only when
   they reduce reading or decision effort.
6. Verify the saved artifact with Markover's existing Node/npm toolchain and an available
   local preview path. Do not install tooling solely to inspect an ELI5 page.
7. Hand off the real absolute filesystem path as the primary link.

## File Location

- Put plan-level explainers beside their plans as
  `doc/plans/<date>__topic-eli5.html`.
- Put design explainers beside their source material under `doc/design/`.
- Put PR or implementation explainers in the most relevant existing `doc/` or `docs/`
  directory. Use `docs/` only when the artifact is intentionally part of the public
  documentation site.
- Keep local file references and path attributes repository-relative. Never commit
  absolute worktree paths.
- Make the HTML directly viewable from its saved filesystem path. Do not make the user
  depend on localhost, an open preview tab, or an agent-owned process.

## Stack And Dependency Contract

- Produce one HTML file with inline CSS, inline JavaScript, and inline explanatory SVGs.
- Use browser-native HTML, CSS, and JavaScript. Do not add a framework, CDN, remote asset,
  external font, tracking script, build step, package, or runtime.
- Do not add Python, Ruby, shell, or another language for generation or verification.
  When deterministic project tooling is genuinely required, use TypeScript or JavaScript
  with the repository's Node.js 22/npm setup and existing dependencies.
- Reuse the existing `node:test` and `jsdom` approach demonstrated in
  `test/docs-site.test.js` when durable automated interaction coverage is warranted.
  Do not add Playwright, Mermaid, a static-server package, or another browser dependency
  just for an ELI5 artifact.
- Prefer a small hand-authored inline SVG for diagrams. If a complex topology is easier
  to author as Mermaid, keep its source as optional context but render the final diagram
  without introducing a Mermaid runtime or package.
- Treat temporary servers or preview processes as verification-only. Stop them before
  handoff and never present their URLs as the artifact link.

## Content Contract

Keep the document as small as the user's decision needs. Start with a top-level view,
not a comprehensive alternate plan. Include only useful blocks, which may include:

- a clear title and one-paragraph plain-English lede
- visible truth context near the title when the explanation describes proposed, evolving,
  historical, branch-specific, or otherwise time-sensitive work
- `The Tiny Story`: what changed, why it matters, and what does not change
- a diagram for an important flow, relationship, state change, or mental model that prose
  cannot explain as clearly
- `What This Adds` or `What This PR Changes`: concise cards or bullets
- `What Does Not Happen`: explicit non-goals, especially for tooling or automation work
- `Important Tradeoffs` or `Risks`: only the decisions the user should inspect
- `Questions To Answer`: `details`/`summary` rows with one textarea per requested decision,
  marked with `data-question`
- `What I'd Change`: recommendation rows with one optional note textarea marked with
  `data-change`
- optional inline `Approve` and `Reject` controls for concrete recommendations
- `References`: authoritative plans, docs, tests, and source files checked
- a compact prompt/context disclosure outside the main reading path
- a sticky `Copy Answers` button that copies all feedback as Markdown

For a simple explanation, a title, lede, tiny story, one comparison or diagram, and a few
references may be enough. Do not make the ELI5 longer than its source unless the extra
structure materially reduces confusion or collects required decisions.

## Truth Context

Treat truth context as part of the explanation, not as prompt provenance. When claims can
age, put a compact, visible `Where This Is True`, `Truth Context`, or equivalent block
near the title and before the Tiny Story. Do not hide it in a footer or disclosure.

Include the smallest set that lets a future reader judge the document correctly:

- the subject and canonical source, such as a PR, issue, plan, release, branch, or commit
- the subject's status when the explainer was written: proposed, open, merged, accepted,
  released, historical, or another precise state
- the snapshot date or immutable revision when exact source state matters
- the scope where the claims apply, including important boundaries omitted from the model
- the parent roadmap, launch gate, milestone, or PR-stack position when one exists
- known follow-on or superseding work and how it may change the picture
- a clear distinction between the stable center of the explanation and transient details
- an authoritative place to re-check current truth

Use live canonical links for moving status and immutable links for exact snapshots. A date
alone is not enough when a PR, issue, roadmap, or plan is the real source of truth. Describe
known changes with calibrated language such as `will`, `may`, or `outside this diagram`;
do not invent a future architecture merely to fill the section. Never present an open PR
or accepted plan as though it were already the timeless architecture of the product.

## Voice And Visual Style

Use direct language, short paragraphs, and scannable structure. Prefer a serious
editorial-tool feel with warmth over a generic developer dashboard or marketing page.

When the artifact represents Markover, follow
`doc/design/2026-08-01__brand-implementation-brief.md` and start with these light-theme
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

- Use solid colors and quiet warm shadows. Avoid gradients, glass effects, saturated
  shadows, generic blue focus colors, and purple/violet palettes.
- Keep light mode as the baseline. Add dark/system appearance only when it helps the
  artifact, and preserve readable contrast in every state.
- Keep brand presence restrained on working documents. Do not duplicate path data from
  the canonical Markover SVGs into a self-contained explainer. Omit the logo or use a
  small generic inline document favicon instead.
- Use tabs only for genuinely parallel alternatives or current/proposed states. Prefer
  scrolling for a linear explanation.

## Controls And Icons

Prefer clear text labels. Markover has no general-purpose icon package to consume from a
standalone document.

- Inline only the tiny SVG geometry needed by an icon-only control.
- Keep control icons `currentColor`, give every icon-only button an `aria-label`, and add
  visually hidden text when it improves context.
- Do not import the app's runtime sprite, canonical brand SVGs, external icon fonts, or a
  new icon dependency.
- Use a plus magnifier for diagram zoom and an `x` for a pinned close control when icons
  make those actions easier to scan.

## Prompt And Context

Keep prompt and conversation context outside the main reading path. Use a small
`Prompt/context` button, footer disclosure, or modal. Curate rather than transcribe:

- include the user's terse request
- name the plan, PR, diff, or docs being explained
- include only constraints that materially shaped the result
- note authoritative sources checked and assumptions worth remembering

Do not let context compete with the Tiny Story, decisions, or feedback controls.
This disclosure answers why the explainer was made. It does not replace the visible truth
context that tells the reader when and where its claims apply.

## Diagrams

Use a diagram only when prose would leave an important relationship fuzzy. Prefer
top-to-bottom flow for complex relationships and left-to-right flow only for short linear
sequences.

- Render the final diagram as accessible inline SVG with a title or adjacent explanation.
- Keep diagram text readable on narrow screens. Put an intrinsically wide diagram in a
  clearly contained horizontal scroller.
- Put optional diagram source behind a small `Source` button or modal anchored to the
  card. Keep source text out of the main flow.
- Keep controls, feedback forms, and source disclosures outside the diagram surface.
- Add zoom only when labels are hard to inspect at normal width. Make the first zoom fit
  the card to the viewport with a safety margin and no tiny scroll range.
- Add a second zoom only when it can make the smallest text roughly `1em` without becoming
  a no-op. Keep the left edge reachable.
- Pin the close control in the upper right and the optional second-level zoom in the lower
  right without consuming diagram layout.
- Avoid page-level `.node` CSS classes because diagram tooling commonly reserves that
  name.

## Feedback Controls

Keep feedback rows collapsed by default. Put inline `Approve` and `Reject` buttons beside
the summary only when the row describes a concrete suggestion or decision.

- Keep one textarea inside each row and mark it with `data-question` or `data-change`.
- Store decisions on the row, for example as
  `data-feedback-state="approved"` or `data-feedback-state="rejected"`.
- Use a success color for approval and an error color for rejection, with text or icons so
  color is not the only signal.
- Include each decision state and its optional note in copied Markdown.
- Do not add approve/reject controls to explanatory rows, references, or prompt context.

## Clickable References

Use ordinary `https` links for authoritative remote sources such as the PR, issue,
roadmap, plan, release, or documentation that establishes truth context. These links are
navigation, not runtime dependencies. Give them descriptive text and prefer canonical
sources over search results or copied summaries.

Show local references as durable repository-relative paths. When clickable local source
links materially help, store only repository-relative metadata in the committed HTML:

```html
<html data-repo-doc-path="doc/plans/2026-08-03__example-eli5.html">
<!-- ... -->
<a href="#" data-repo-path="src/main.js" data-repo-line="42">src/main.js:42</a>
```

Resolve the local repository root at runtime from the ELI5 file location or an explicit
preview query parameter. Do not commit absolute paths or editor-specific URLs:

```html
<script>
  function eli5RepoBase() {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("baseUrl") || params.get("repoBase");
    if (explicit) return explicit.replace(/\/$/, "");

    const docPath = document.documentElement.dataset.repoDocPath;
    if (window.location.protocol === "file:" && docPath) {
      const fullPath = decodeURIComponent(window.location.pathname);
      const suffix = `/${docPath.replace(/^\//, "")}`;
      return fullPath.endsWith(suffix) ? fullPath.slice(0, -suffix.length) : "";
    }

    return "";
  }

  function eli5WireRepoLinks() {
    const repoBase = eli5RepoBase();
    for (const link of document.querySelectorAll("a[data-repo-path]")) {
      if (!repoBase) {
        link.setAttribute("aria-disabled", "true");
        link.title = "Open the saved file directly or add ?baseUrl=/path/to/worktree.";
        continue;
      }

      const repoPath = link.dataset.repoPath.replace(/^\//, "");
      link.href = encodeURI(`file://${repoBase}/${repoPath}`);
    }
  }

  eli5WireRepoLinks();
</script>
```

Treat line numbers as visible orientation only; a normal `file:` link cannot guarantee
that every viewer opens an editor at that line.

## Feedback Script

Include a small inline script that:

- finds `textarea[data-question]` and `textarea[data-change]`
- reads recommendation state from rows with approve/reject controls
- formats answers under `## Questions` and `## Notes On Proposed Plan Changes`
- includes approve/reject state next to the matching recommendation
- uses `navigator.clipboard.writeText` when available
- falls back to a temporary textarea plus `document.execCommand("copy")`
- reports copy success or failure through an `aria-live` status element

Keep all feedback local to the page. Do not add storage, telemetry, network submission,
or external dependencies unless the user explicitly requests them.

## Verification

For a substantial ELI5 artifact:

1. Confirm the saved HTML is readable and contains no remote runtime assets, external
   dependencies, absolute committed paths, or accidental dependencies. Check that every
   remote URL is an intentional authoritative navigation link.
2. For time-sensitive claims, confirm the visible truth context identifies the subject,
   status, scope, roadmap position when relevant, known change horizon, and current source
   of truth.
3. Use the project's existing Node.js and `jsdom` stack for scripted DOM and interaction
   checks when needed. Add a focused `node:test` test only when the artifact is durable
   product behavior that should remain covered.
4. Use the T3 in-app preview when available for desktop and narrow visual checks. Prefer
   direct filesystem preview. Do not install or launch a different browser stack merely
   for routine verification.
5. If no visual preview path is available, run the strongest static/DOM checks available
   and say once that rendered browser verification was not performed.
6. Run `npm run check` and `npm test` before committing a completed skill or repository
   artifact change.

Check that:

- desktop and narrow layouts have no unintended horizontal page overflow
- diagrams and tables fit or scroll within their containers
- source modals and diagram controls open, close, and do not obscure content
- zoom keeps the left edge reachable and restores the original card position
- appearance controls work when present and preserve readable contrast
- accordion rows and textareas are keyboard-usable
- approve/reject controls expose their state accessibly
- copied Markdown includes every answer, note, and decision state

## User Handoff

- Put the ELI5 link near the top of the final response.
- Use a direct Markdown link to the real absolute filesystem path as the primary link,
  such as `[Open ELI5](/absolute/path/doc/plans/example-eli5.html)`.
- Include the repository-relative path as secondary context when useful.
- Never use localhost, a temporary preview URL, a signed asset URL, or an already-open tab
  as the durable handoff.
- Verify that the linked path exists and is readable immediately before handoff.
