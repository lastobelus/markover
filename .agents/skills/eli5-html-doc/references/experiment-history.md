# ELI5 Experiment History

Read this only when changing `eli5-html-doc` or evaluating another ELI5 experiment.
Preserve accepted lessons and explicitly avoid rejected patterns.

## Loop 1: Structure, Context, Theme, And Diagram Source

Status: partially accepted.

Keep:

- Keep a readable light theme as the default.
- Allow optional dark/system appearance when useful.
- Keep plain language, short paragraphs, and compact structure.
- Improve important diagrams and keep their source behind a small button or modal.
- Keep prompt/context outside the main reading flow.
- Keep feedback disclosures and add inline approve/reject controls only for concrete
  recommendations or decisions.

Avoid:

- Do not make tabs the default for ordinary linear explanations.
- Do not give prompt/context top-level reading space.
- Do not make prose abstract, verbose, or promotional to support a visual concept.
- Do not replace the established light reading experience with a dark-first treatment.

## Loop 2: Interactive Diagram Feedback Surfaces

Status: rejected.

- Do not add layer toggles, connection filters, node-comment sidebars, or diagram-as-app
  behavior as stable guidance.
- Do not make a diagram more complex merely to create interactive layers.
- Do not place controls, comment panels, or forms over diagram content.

Preserve diagram real estate. Put controls and feedback above, below, or in a temporary
pop-out that does not reduce the diagram's normal viewing area.

## Loop 3: Diagram Zoom

Status: accepted.

- Add zoom when labels are hard to inspect at normal document width.
- Make the first zoom fit the diagram card to the viewport with a safety margin and no
  tiny horizontal or vertical scroll range.
- Add a second zoom only when it can make the smallest text roughly `1em` without making
  the diagram smaller or creating a no-op state.
- Keep the diagram's left edge reachable, especially when it remains wider than the
  viewport.
- Pin a translucent circular close control in the upper right and the optional second
  zoom control in the lower right without consuming diagram layout.
- Use tiny self-contained `currentColor` SVGs for controls. Do not require Dragonlist's
  former Heroicons source or add an icon dependency to Markover.

The accepted behavior made dense diagrams easier to inspect without reviving the
rejected diagram-as-app interaction model.

## Loop 4: Truth Context And Change Horizon

Status: accepted.

- Put truth context near the title when an explainer describes a moving target.
- Identify the specific PR, issue, plan, release, branch, or revision whose state is being
  explained, and link to the authoritative source when one exists.
- Show the roadmap, launch gate, milestone, or stack position that gives the work meaning.
- Distinguish the explanation's stable center from known follow-on work that will or may
  change its details.
- Keep prompt and conversation provenance in a quiet disclosure; it answers a different
  question and does not replace visible applicability context.
- Allow intentional remote navigation links to authoritative sources while continuing to
  forbid remote assets and runtime dependencies.

Avoid timeless language for proposed or transient architecture, hiding validity context
in the footer, or speculating about an unknown future design.
