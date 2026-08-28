# App structure

This document is the source of truth for Markover's first-level visual structure. Use [the glossary](../../GLOSSARY.md) for concise definitions.

```text
App shell
├── App header
└── Pane layout
    ├── Left pane
    ├── Center pane
    └── Right pane
```

## Structural names

| Structure | TypeScript stem | CSS name | Theme-token prefix | Current content |
| --- | --- | --- | --- | --- |
| App shell | `appShell` | `.app-shell` | `--app-shell-*` | App header and pane layout |
| App header | `appHeader` | `.app-header` | `--app-header-*` | App-level identity, actions, and status |
| Pane layout | `paneLayout` | `.pane-layout` | `--pane-layout-*` | Left, center, and right panes |
| Left pane | `leftPane` | `.left-pane` | `--left-pane-*` | Review navigation and documents list |
| Center pane | `centerPane` | `.center-pane` | `--center-pane-*` | Document tree |
| Right pane | `rightPane` | `.right-pane` | `--right-pane-*` | Annotation views |

## Naming rule

First-level architecture uses structural names. Code identifiers, documentation,
tests, and semantic theme tokens use the matching stem from the table whenever
they identify one of these regions. A prefix is a naming contract, not a
requirement that every structure define a theme token.

Content keeps content-specific names. Review navigation, documents list, document tree, annotation views, source card, and similar components describe what appears inside a structural region. They do not rename that region. User-facing labels and accessibility names should describe the task or content when that is more useful than a positional name.

The app shell's DOM boundary contains the app header and the app empty state or
pane layout. The current app header owns its bar and durability warning. The
left pane owns the review navigation strip and documents list. Dialogs,
popovers, toasts, startup screens, and prototype surfaces are outside the shell
even when they visually overlay it.

Use **pane layout** for the visual container. Markover already uses **workspace** for app-private persisted state, and development tooling also uses workspace for filesystem and execution contexts.

When a structural reference and its content both matter, name them together: for example, “the document tree in the center pane” or “the left pane's documents list.”

## Theme boundary

Theme primitives hold palette and appearance values. Structural semantic tokens
map those values to the first-level regions, and structural selectors consume
the semantic tokens rather than naming the current contents.

| Structural token | Current base mapping |
| --- | --- |
| `--app-shell-background` | `--ground` |
| `--app-header-background` | `--app-shell-background` |
| `--left-pane-background` | `--neutral-soft` |
| `--center-pane-background` | `--paper` |
| `--right-pane-background` | `--neutral-soft` |

Palette and appearance overrides may replace a base mapping with a literal or
another theme role. For example, Olive light maps the app shell to a
palette-specific literal.
The floating theme-token inspector reports each token's live computed custom-
property value so these overrides remain truthful.

Use full property suffixes such as `-background` for structural tokens. Child
content and component tokens keep their existing names until their vocabulary
pass defines that layer. A structural rename preserves these mappings; changing
or unifying their underlying colors is a separate visual decision.

When a component needs the same current value as a structural region outside
its own boundary, give the component a role-based alias. For example,
`--keyboard-help-background` currently derives from
`--app-shell-background`; the keyboard-help selector consumes the component
alias, so a later shell color change does not silently redefine the component's
meaning.

## Scope

This contract fixes only the first level of the app structure. Child regions and components keep their current names until their own vocabulary pass defines them.

The next pass names the principal contents of the app header and each pane. The
pass after that covers components, dialogs, settings, and transient surfaces.
Color consolidation is a separate visual pass and requires visual QA.
