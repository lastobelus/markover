# Optional surfaces

Read the section for the surface you are actually building. Each one ends with what to
check once it exists. None of this is required in an ELI5 — a page with none of these
surfaces needs none of this file.

## Diagrams

Use a diagram only when prose would leave an important relationship fuzzy. Prefer
top-to-bottom flow for complex relationships, and left-to-right only for a short linear
sequence.

After deciding that a diagram is useful, check for the optional shared diagram-design
skill at
`~/.local/share/agent-contexts/vendor/diagram-design/skills/diagram-design/SKILL.md`.
When that file is readable, read it completely and resolve its relative references from
the directory that contains it. Load only the reference for the selected diagram type,
plus `semantic-patterns.md` when the design needs those patterns; read another reference
only when the chosen design explicitly requires it. If the shared skill or a required
reference is absent or unreadable, continue quietly with the guidance below. Do not
install, fetch, update, copy, vendor, or register diagram-design as part of an ELI5 task.

Use diagram-design for diagram type selection, information density, layout grammar, SVG
primitives, and connector routing. This skill still owns the enclosing explanation,
truth context, Markover visual language, accessibility, responsive containment,
self-contained inline output, and verification. Those ELI5 requirements win whenever
the two sources differ. In particular, skip diagram-design's first-run onboarding or
style-confirmation pause, standalone page shell, remote fonts, export workflow, and
separate-artifact handoff. Render the result as accessible inline SVG inside the ELI5,
and preserve the accepted non-interactive diagram model below.

- Render the final diagram as accessible inline SVG with a title or an adjacent
  explanation. If a complex topology is easier to author as Mermaid, keep that source as
  optional context and render the diagram without a Mermaid runtime.
- Keep diagram text readable on narrow screens. An intrinsically wide diagram belongs in a
  clearly contained horizontal scroller.
- Put optional source behind a small `Source` button or modal anchored to the card, out of
  the main flow.
- Keep controls, feedback rows, and source disclosures off the diagram surface itself.
- Add zoom only when labels are hard to inspect at normal width. The first zoom fits the
  card to the viewport with a safety margin and no tiny scroll range. Add a second level
  only when it can make the smallest text roughly `1em` without becoming a no-op, and keep
  the left edge reachable.
- Pin the close control in the upper right and the optional second zoom in the lower
  right, without consuming diagram layout.
- Avoid page-level `.node` CSS classes; diagram tooling commonly reserves that name.

**Check:** the diagram fits or scrolls inside its container at desktop and narrow widths.
When present, the source modal opens, closes, and covers nothing it shouldn't, and zoom
keeps the left edge reachable and restores the card's original position.

## Feedback controls

Keep feedback rows collapsed by default. Put inline `Approve` and `Reject` buttons beside
a summary only when the row is a concrete suggestion or decision — never on explanatory
rows, references, or the prompt disclosure.

- One textarea per row, marked `data-question` or `data-change`.
- Store the decision on the row, such as `data-feedback-state="approved"` or
  `data-feedback-state="rejected"`.
- Success color for approval, error color for rejection, always with text or an icon so
  color is not the only signal.

A sticky `Copy Answers` button copies everything as Markdown. Its inline script finds
`textarea[data-question]` and `textarea[data-change]`, reads the state of rows that have
approve/reject controls, formats the result under `## Questions` and
`## Notes On Proposed Plan Changes` with each decision beside its recommendation, and
writes it with `navigator.clipboard.writeText`, falling back to a temporary textarea and
`document.execCommand("copy")`. Report success or failure through an `aria-live` element.

Feedback stays on the page. No storage, telemetry, or network submission unless the user
asks for it.

**Check:** rows and textareas are keyboard-usable; approve/reject state is exposed
accessibly; and the copied Markdown contains every answer, note, and decision state. Type
something in before testing the copy — copying an empty form verifies nothing.

## Clickable local repository links

Ordinary `https` links to a pull request, issue, or plan need nothing from this section.
Show local references as durable repository-relative paths. When clickable local source
links genuinely help, commit only repository-relative metadata:

```html
<html data-repo-doc-path="doc/plans/2026-08-03__example-eli5.html">
<!-- ... -->
<a href="#" data-repo-path="src/main.js" data-repo-line="42">src/main.js:42</a>
```

Resolve the repository root at runtime from the page's own location or an explicit preview
parameter, and commit no absolute path or editor-specific URL:

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
</script>
```

Then wire the links with the recipe for the host project. Markover uses `data-repo-path`
and `file:` URLs:

```html
<script>
  function eli5WireRepoLinks() {
    const repoBase = eli5RepoBase();
    for (const link of document.querySelectorAll("a[data-repo-path]")) {
      if (!repoBase) {
        link.removeAttribute("href");
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

Dragonlist uses `data-zed-path`, an optional `data-zed-line`, and `zed:` URLs:

```html
<script>
  function eli5ZedHref(repoBase, repoPath, line) {
    const cleanPath = repoPath.replace(/^\//, "");
    const suffix = line ? `:${line}` : "";
    return encodeURI(`zed://file/${repoBase}/${cleanPath}${suffix}`);
  }

  function eli5WireZedLinks() {
    const repoBase = eli5RepoBase();
    for (const link of document.querySelectorAll("a[data-zed-path]")) {
      if (!repoBase) {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        link.title = "Open the saved file directly or add ?baseUrl=/path/to/worktree.";
        continue;
      }

      link.href = eli5ZedHref(repoBase, link.dataset.zedPath, link.dataset.zedLine);
    }
  }

  eli5WireZedLinks();
</script>
```

Keep the two recipes separate rather than unifying them; each is short and matches the
shapes already in use. `data-zed-line` is passed to Zed as best-effort line navigation,
while a plain `file:` URL uses the visible line number as orientation only.

**Check:** the verifier resolves every target, and with no base resolvable the links drop
their `href` and explain themselves in a title rather than jumping to the top of the page.

## Icon-only controls

Prefer a clear text label. There is no general-purpose icon package for a standalone
document to consume.

- Inline only the tiny SVG geometry the control needs, drawn in `currentColor`.
- Give every icon-only button an `aria-label`, plus visually hidden text when it adds
  context.
- Do not import the app's runtime sprite, the canonical brand SVGs, an icon font, or a new
  dependency.
- A plus magnifier reads as diagram zoom and an `x` as a pinned close control.

**Check:** every icon-only control has an accessible name.
