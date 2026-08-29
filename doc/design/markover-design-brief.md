# Markover design brief

## Status and source-of-truth boundary

This is the current visual brief for Markover. It governs the desktop product,
public documentation, repository presentation, launch media, and diagrams that
claim to represent the current product.

Use the sources in this order:

1. `docs/developer/app-structure.md` defines the app's first-level structural
   names and semantic theme boundary.
2. `src/styles.css` implements the live product tokens and theme variants.
3. This brief defines the visual intent and how those product decisions carry
   into public and explanatory surfaces.
4. Surface-specific plans and mockups may specialize composition, but they do
   not redefine the product palette or structure.

The dated `doc/design/2026-08-01__brand-implementation-brief.md` records the
earlier brand implementation pass. It remains useful history, but its older
surface model and token values are not current guidance.

## Intent

Markover should feel like a serious editorial tool with warmth, not a generic
developer dashboard. Irregular human-drawn brand geometry sits beside a quiet
paper-and-ink interface. Brand presence is strongest while introducing or
orienting someone and recedes once they are working.

The current product expression is **Ember Light**: warm ground around a pale
paper document, quiet neutral side panes, dark editorial ink, and a restrained
ember accent. Public materials should look like the same product, not a
separate marketing skin.

## Product structure

Represent the current desktop app as an **App header** above a **Pane layout**
with **Left**, **Center**, and **Right panes**. The left pane contains review
navigation and the documents list, the center pane contains the document tree,
and the right pane contains annotation views.

Do not depict the retired app-wide document-tab strip, checksum treatment, or
two-pane layout in a surface that claims to be current. Use the exact
structural vocabulary from `docs/developer/app-structure.md` in code, tests,
design notes, captions, and diagrams.

## Ember Light palette

These values are the current light-theme roles implemented by
`src/styles.css`:

| Role | Product token | Value | Use |
| --- | --- | --- | --- |
| Primary brand | `--markover-primary` | `#c94e1f` | Focus, selected emphasis, focal non-text marks, and large or bold accent text |
| Secondary brand | `--markover-secondary` | `#6d211f` | Deep brand ink, links, and normal-size branded text |
| Ink | `--ink` | `#26211e` | Primary text, strong icons, and structural strokes |
| Muted ink | `--muted` | `#6f6761` | Metadata, captions, and quiet labels |
| Ground | `--ground` | `#e8e2d8` | App shell and page surround |
| Paper | `--paper` | `#f7f4ee` | Document canvas and primary reading surface |
| Quiet neutral | `--neutral-soft` | `#ece9e2` | Left and right panes and secondary regions |
| Raised surface | `--surface` | `#fffdf9` | Focused cards, controls, and raised working surfaces |
| Rule | `--line` | `#ddd5cc` | Dividers, borders, and low-emphasis structure |
| Soft brand | `--brand-soft` | `#f5e3da` | Quiet branded fills and selection support |
| Code | `--code` | `#262b2b` | Code surfaces |

Use solid colors. Avoid gradients, glass effects, saturated shadows, generic
blue focus rings, and ornamental color. Warm shadows may use ink at low alpha.
The primary ember is 4.16:1 against paper, so use the burgundy for normal-size
branded text; reserve ember for larger/bolder text, controls, focus, strokes,
and other non-text emphasis. Ink and muted ink are 14.51:1 and 5.05:1 against
paper respectively.

## Spatial hierarchy

The App shell uses ground; the App header inherits the shell; the left and
right panes use quiet neutral; and the center pane uses paper. Seams and
resizers should read through small value changes and rules rather than heavy
boxes or shadows. Raised surface is an exception for focused controls and
overlays, not a replacement canvas for every region.

Keep the reading surface dominant. Side panes may be information-dense, but
their lower contrast and neutral fill should hold them behind the document.
Selections bridge content and feedback with restrained brand-soft color and a
clear ember or burgundy edge.

## Typography

Product and public working surfaces use the app's native stacks:

- Sans: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`
- Mono: `ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace`
- Serif: `Georgia, "Times New Roman", serif`

Use sans for product names, controls, navigation, and prose; mono for IDs,
commands, metadata, source, and technical labels; and serif sparingly for an
editorial title or callout. Do not add a remote font dependency merely to make
a public or self-contained artifact feel more branded. The custom logotype is
vector artwork, not a substitute body font.

## Brand assets and prominence

The canonical sources are:

- `design/brand/markover-mark.svg`
- `design/brand/markover-logotype.svg`
- `design/brand/markover-lockup.svg`
- `design/brand/markover-app-icon.svg`
- `design/brand/markover-app-icon.png`
- `design/brand/markover-readme-leader.svg`

Do not redraw the mark, substitute ordinary type for the logotype, stretch an
asset, or duplicate its paths into application or documentation code.

- Introductory surfaces may use the full lockup and the descriptor
  “Structured review for Markdown.”
- Orienting surfaces may use the lockup or separated mark and logotype.
- Working surfaces use a restrained mark-and-logotype treatment or the mark
  alone. They do not carry a tagline.

Keep one accessible “Markover” name per brand cluster and empty alternative
text on adjacent decorative pieces.

## Public surfaces

- README and Pages use Ember Light typography, spacing, and hierarchy.
- The README leader remains vector artwork; descriptive copy and navigation
  remain live text.
- The Pages hero depicts the current App header and three-pane structure in
  responsive HTML/CSS rather than baking interface text into an image.
- Repository social previews use a 1280×640 canvas. Pages Open Graph cards use
  1200×630. Both use a solid Ember Light background, canonical lockup, short
  descriptor, and at most one truthful product crop.
- README and Pages should use the same strongest current screenshot rather
  than selecting unrelated hero images.
- Dated explorations stay historical. Undated usage boards, fixtures, and
  examples must either match the current product or state clearly that they
  are prototypes.

## Screenshots and movies

Product media is evidence, not illustration. Capture the real current app from
an exact recorded commit in an isolated, sanitized state. Select Ember + Light
explicitly, use production branding, disable notifications, and inspect every
frame for real paths, repositories, thread identities, review data, or other
private material.

Do not composite, regenerate, or AI-edit application pixels. A screenshot may
be cropped or losslessly optimized only when that does not change what the UI
claims. Movies use deliberate cursor movement, readable burned-in captions,
no incidental audio, and a transcript.

## Explanatory diagrams

The tables below are Markover's repository-owned Diagram Design profile for
ELI5 work. They are approved onboarding, so an ELI5 thread uses them directly
instead of starting Diagram Design's machine-profile setup. Diagram geometry,
density, routing, accessibility, and type-specific rules remain owned by the
shared `diagram-design` skill when it is available.

### Semantic roles

| Role | Purpose | Light | Dark |
| --- | --- | --- | --- |
| `paper` | Page background and default node fill | `#f7f4ee` | `#1d1816` |
| `paper-2` | Diagram container and secondary fill | `#fffdf9` | `#29211e` |
| `ink` | Primary text and stroke | `#26211e` | `#f4ece7` |
| `muted` | Secondary text and default arrows | `#6f6761` | `#b7aaa3` |
| `soft` | Sublabels and boundary labels | `#756d67` | `#a69a94` |
| `rule` | Hairline borders | `rgba(38,33,30,0.12)` | `rgba(244,236,231,0.12)` |
| `rule-solid` | Stronger borders and baselines | `#ddd5cc` | `#4a3a34` |
| `accent` | One or two focal elements | `#c94e1f` | `#e5b8a8` |
| `accent-tint` | Fill for accent-bordered boxes | `rgba(201,78,31,0.08)` | `#432923` |
| `link` | External and HTTP/API connections | `#6d211f` | `#e5b8a8` |

### Typography roles

| Role | Family | Size | Weight | Use |
| --- | --- | --- | --- | --- |
| `title` | Georgia, `"Times New Roman"`, serif | `1.75rem` | 400 | Page title |
| `node-name` | `-apple-system`, BlinkMacSystemFont, `"SF Pro Text"`, system-ui, sans-serif | `12px` | 600 | Human-readable labels |
| `sublabel` | ui-monospace, `"SF Mono"`, SFMono-Regular, Menlo, monospace | `9px` | 400 | Ports, URLs, field types |
| `eyebrow` | ui-monospace, `"SF Mono"`, SFMono-Regular, Menlo, monospace | `7–8px` | 500 | Uppercase type and axis labels |
| `arrow-label` | ui-monospace, `"SF Mono"`, SFMono-Regular, Menlo, monospace | `8px` | 400 | Connector annotations |
| `callout` | Georgia, `"Times New Roman"`, serif italic | `14px` | 400 | Editorial asides |

These are native system stacks and require no remote font. Resolve every visual
role from these tables even when the installed Diagram Design skill has a
different default or machine-local profile.

## Accessibility and responsive behavior

Normal text meets WCAG AA against its rendered background. Focus stays visible
without relying on color alone. Decorative logos use empty alternative text;
meaningful product media has specific captions and alternative text.

At narrow widths, preserve reading order and task hierarchy. Collapse or stack
secondary regions rather than shrinking three panes into illegibility. Keep
controls reachable by keyboard, captions readable without opening media, and
motion optional and non-autoplaying.

## Acceptance checks

- A current visual uses the App header and three-pane structure and contains no
  retired tab-strip or checksum UI.
- Ground, paper, quiet panes, ink, and accent map to the values in this brief.
- The center document remains the visual focus while navigation and annotation
  panes stay legible but quieter.
- Brand geometry comes from canonical SVGs and recedes on working surfaces.
- Normal text and controls remain readable and accessible at desktop and
  narrow widths.
- Screenshots and movies are real, current, sanitized product captures with a
  recorded source commit.
- Diagrams resolve Markover's visual mapping while retaining the diagram
  system's structural rules.

## Boundaries

This brief does not redefine application behavior, child-component names,
portable review format, or the semantics of non-Ember palettes. It does not
turn dated explorations into current requirements. When product implementation
and a public mock disagree, fix the mock or label it historical; do not change
the product merely to preserve old collateral.
