# Decision register

This is the authoritative record of Markover's product and architecture
decisions. Statements describe behavior landed on `main`; approved but
unlanded direction is named as planned work instead. Historical prototype
choices remain visible only where their disposition helps explain the current
boundary.

## Register contract

- **Retain** means the landed behavior remains the intended boundary.
- **Revise** means the landed behavior or documented boundary needs owned
  follow-up work.
- **Superseded** means a replacement has landed; the old choice is history, not
  a supported path.
- **Planned** means an accepted replacement has an owner but has not landed.
- **Deferred** means the boundary was reconsidered and is intentionally outside
  the current launch scope.

Audit notes cite implementation, tests, or issues rather than treating this
file as evidence of itself. The issue 36 audit started at commit `005d83c` and
was reconciled through commit `51f175f` before publication. An entry without an
**Audit** note has not yet been reassessed.

## Register maintenance

- **Planned — Reconcile from durable Git state.** A gardener compares the last
  successfully audited `main` commit with current `origin/main`, so a later run
  catches merges missed while its host was offline. Manual local `codex exec`
  runs are the interim trigger; the future trusted Intel host adds periodic
  local scheduling, with merge hooks only as optional wakeups. Issue
  [#101](https://github.com/lastobelus/markover/issues/101) owns the harness,
  isolated worktree, single-flight behavior, subscription authentication, and
  human-reviewed output. GitHub-hosted execution is excluded because the
  official action expects an API key and official guidance warns against using
  ChatGPT-managed CI authentication for public repositories. Evidence:
  [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
  and [Codex GitHub Action](https://learn.chatgpt.com/docs/github-action).

## First-prototype disposition index

The first prototype was recorded in commit `87977d8`. This index disposes of
each choice from that baseline without duplicating the live decisions below.

### Data and parsing

- **P-D1 — Retain.** The exact source, checksum, tree, and block feedback remain
  the review artifact. See Data and parsing 1 and the
  [tree contract](src/contracts.ts).
- **P-D2 — Retain.** Document-order block IDs remain intentionally stable only
  for the exact source. A review preserves that source and checksum, so
  cross-revision annotation matching is unnecessary for the current workflow.
  See Data and parsing 2 and the
  [deterministic-tree tests](test/tree.test.ts).
- **P-D3 — Superseded.** The hand-written line scanner was replaced by
  `markdown-it`, expanding CommonMark block coverage and preserving exact
  source for constructs outside the selectable tree. The remaining extension
  visibility boundary is planned under issue
  [#15](https://github.com/lastobelus/markover/issues/15). See Data and parsing
  3 and 8 and the
  [extension-degradation test](test/tree.test.ts).
- **P-D4 — Retain.** Headings and lists still share one structural tree. See
  Data and parsing 4 and the [navigation tests](test/navigation.test.ts).

### Interaction

- **P-I1 — Retain.** Selection still targets a visible review block rather than
  the synthetic document root. See Interaction 1.
- **P-I2 — Retain.** Arrow keys still navigate the document structure. See
  Interaction 2 and the [navigation tests](test/navigation.test.ts).
- **P-I3 — Superseded.** The two-pane Tab toggle became an ordered focus cycle
  across the optional Documents sidebar, Document tree, and Annotation pane.
  See Interaction 3 and the [keyboard contract tests](test/brand.test.ts).
- **P-I4 — Superseded.** In-memory annotations became durable managed reviews
  with bounded-loss autosave and restart restoration. See Interaction 4,
  [review-store tests](test/review-store.test.ts), and issue
  [#39](https://github.com/lastobelus/markover/issues/39).

### Agent handoff

- **P-H1 — Superseded.** Clipboard Markdown is no longer the integration.
  Product-independent `open`/`get`/`edit` commands now provide the primary
  machine-readable handoff. See Agent handoff 1 and
  [CLI tests](test/markover-cli.test.ts).
- **P-H2 — Retain.** The complete JSON tree remains available through `get` and
  the clipboard escape hatch. See Agent handoff 5–7.

### Originally deferred work

- **P-X1 — Superseded.** CommonMark block parsing and rich inline rendering
  landed. See Data and parsing 3 and 7.
- **P-X2a — Superseded.** Saving, bounded-loss recovery, and one-time import of
  the former managed-review directory landed. See Interaction 4 and issue
  [#39](https://github.com/lastobelus/markover/issues/39).
- **P-X2b — Deferred.** Importing, merging, or migrating annotations onto a
  different source revision remains outside the exact-source review workflow.
  See Data and parsing 2.
- **P-X3 — Deferred.** Matching annotations across document edits remains
  unnecessary while every review carries immutable source plus checksum and
  source edits are proposals rather than document mutations.
- **P-X4 — Superseded.** A local authenticated CLI and loopback service provide
  direct handoff without coupling Markover to one agent product. See Agent
  handoff 1–5 and Local service authorization.
- **P-X5 — Superseded.** The application now restores and switches among
  multiple independent reviews. See Multi-document application state.
- **P-X6a — Superseded.** Packaging and Electron hardening landed. The remaining
  renderer `file:`-origin revision is planned under issue
  [#95](https://github.com/lastobelus/markover/issues/95). See Electron
  privilege boundary.
- **P-X6b — Planned.** Keyboard and VoiceOver acceptance is a broad-announcement
  gate owned by issues [#15](https://github.com/lastobelus/markover/issues/15)
  and [#91](https://github.com/lastobelus/markover/issues/91).
- **P-X6c — Planned.** Developer ID signing and notarization are owned by issue
  [#13](https://github.com/lastobelus/markover/issues/13). App Sandbox and
  auto-update are assessed with the later release decisions in this register.
- **P-X7 — Revise.** The handoff tree declares format `markover-review` version
  1, but no owned compatibility policy says what agents or future Markover
  versions may rely on. Issue
  [#99](https://github.com/lastobelus/markover/issues/99) owns the broad-launch
  contract without adding speculative migration machinery.

## Data and parsing

1. **The tree is the review artifact.** Its `sourceDocument` contains the exact
   Markdown content, its SHA-256 checksum, name, and path when known. Structural
   nodes store reviewer comments in a plainly named `feedback` field.

   **Audit — Retain.** Exact source plus structured feedback is the core
   handoff, and the public workflow depends on agents receiving both together.
   Evidence: [tree contract](src/contracts.ts) and
   [tree tests](test/tree.test.ts).
2. **Node IDs are document-order IDs.** IDs such as `block-7` are deterministic
   for an exact document. No attempt is made to preserve annotations across
   edits; a changed checksum means a different review target.

   **Audit — Retain.** IDs identify blocks inside an immutable review target;
   review ID plus checksum prevents them from claiming cross-revision identity.
   Evidence: [tree construction](src/tree.ts) and
   [deterministic-tree tests](test/tree.test.ts).
3. **Parsing is delegated to the third-party `markdown-it` parser using its
   CommonMark preset.** Markover does not maintain a Markdown grammar. It maps
   `markdown-it`'s token stream and source ranges into review blocks, gaining
   proven block parsing, exact line ranges, hard-wrapped list-item content, and
   room for extensions. Markover currently turns paragraphs, headings, ordered
   and unordered list items, thematic breaks, and code blocks into selectable
   nodes. The built-in table rule is enabled explicitly.

   **Audit — Retain.** This replacement removed the prototype's private parser,
   expanded block coverage, and kept source ranges deterministic. Evidence:
   [parser implementation](src/tree.ts) and
   [parser tests](test/tree.test.ts).
4. **Heading and list structure share one tree.** Lower-level headings become
   children of the nearest higher-level heading. Nested list items become
   children of the preceding less-indented list item.

   **Audit — Retain.** The shared hierarchy remains the useful navigation and
   annotation unit demonstrated by the product. Evidence:
   [tree tests](test/tree.test.ts) and
   [navigation tests](test/navigation.test.ts).
5. **Block quotes and tables are deliberately opaque nodes.** Their complete
   source ranges are selectable and their contents render, but markdown-it's
   nested quote tokens and table rows/cells are not copied into the review tree.
   This tests useful review granularity before adding more navigation levels.
6. **Tasks decorate ordinary list-item nodes.** A leading `[ ]`, `[x]`, or `[X]`
   adds `task` and `checked` fields and is removed from the displayed item text.
   The original marker remains present in the node's raw source.

   Example task nodes:

   - [ ] Review the pending decision
   - [x] Preserve the accepted behavior
7. **Inline Markdown is rendered inside supported blocks.** Bold, italic,
   inline code, link labels, and image labels appear in the left pane. Links
   remain inert. Image pills open the source image in the same labeled preview
   modal used for screenshot attachments; relative paths resolve from the
   reviewed Markdown file.

   **Audit — Retain (Data and parsing 5–7).** Opaque compound blocks, task
   decoration, and inert inline rendering preserve useful review granularity
   without turning Markover into a Markdown editor or browser. Evidence:
   [tree tests](test/tree.test.ts) and
   [image-preview tests](test/image-preview.test.ts).
8. **Unrecognized extensions degrade through CommonMark.** With raw HTML and
   extensions disabled, syntax such as definition lists, footnotes,
   strikethrough, and HTML may appear as literal paragraph content, resolve as
   ordinary reference syntax, or have definition lines absent from the block
   tree. The exact input remains in `sourceDocument.content`; the sampler keeps
   these cases visible for a later unsupported-syntax design.

   **Audit — Retain current behavior; planned public boundary.** Exact source
   preservation makes degradation non-destructive, while issue
   [#15](https://github.com/lastobelus/markover/issues/15) owns the compatibility
   matrix and regression coverage required before broad announcement. Evidence:
   [extension-degradation tests](test/tree.test.ts).

## Interaction

1. **Selection is always a block, never the invisible document root.**

   **Audit — Retain.** Only visible source-backed blocks provide an intelligible
   annotation target. Evidence: [navigation tests](test/navigation.test.ts).
2. **Arrow navigation operates structurally.** Left selects a parent; right
   selects a child or searches outward for the next sibling; up/down move among
   siblings and climb outward at boundaries.

   **Audit — Retain.** Structural movement remains the primary keyboard model
   and has direct behavioral coverage. Evidence:
   [navigation tests](test/navigation.test.ts).
3. **Tab and Shift-Tab cycle review panes.** When the documents list sidebar is
   expanded, focus cycles through Documents, Document tree, and Annotation.
   A collapsed or absent documents list is skipped. Control-Tab remains reserved
   for switching review sessions.

   **Audit — Retain.** The three-surface cycle scales the prototype interaction
   to the optional review inbox without overloading review switching. Evidence:
   [keyboard contract tests](test/brand.test.ts).
4. **Managed reviews are durable sessions.** Each `markover open` call and each
   successful native **Open Markdown…** action creates a distinct review ID.
   Mutations queue complete snapshots for atomic persistence to Markover's
   per-user application-data `reviews` directory within a bounded, configurable
   delay; handoff and orderly shutdown use explicit flush barriers.
   Restarting the single application instance restores every managed review and
   its collapse, feedback, status, and attachment state. Selection is retained
   while switching tabs during an application run and resets to the first block
   after restart. Former checkout-local `.markover/reviews` directories are not
   scanned or imported; historical bytes remain untouched in place.

   **Audit — Retain.** Bounded-loss persistence is necessary for asynchronous
   multi-agent work. The current application has one addressed managed store
   and no eager compatibility reader for former checkout-local reviews. Evidence:
   [review-store tests](test/review-store.test.ts),
   [crash durability tests](test/durability-crash.test.ts), and
   [PR #106](https://github.com/lastobelus/markover/pull/106).
5. **Structural labels do not repeat source markers.** Headings use `H1`, `H2`,
   and so on; ordered items use their actual index; unordered items use an open
   bullet. The block text contains only the item's content.
6. **Ancestors reveal feedback below them.** A block with feedback has a solid
   marker. An ancestor of a block with feedback has a separate, partially
   transparent marker, so collapsed branches do not hide review state. The
   indicator order is own annotation, descendant annotation, then attached
   image. Image indicators propagate through descendants without distinguishing
   where in the subtree the image lives. All three columns remain fixed at the
   right edge; nesting indents only the disclosure and content columns.
7. **The annotation pane includes compact raw source.** Its header contains the
   node type and source line span; list items also show their position and list
   length. A collapsible source panel preserves the selected block's original
   Markdown without hard-wrapping and uses a small monospace font. An explicit
   Edit action creates a proposal in `sourceEdit: { original, current }`; it
   never writes the source document or changes its checksum, `raw`, IDs, or
   structure. Saved proposals render through Pierre Diffs, show line counts in
   the source header and tree row, and replace the tree block's visible content
   while retaining the immutable original for handoff. Revert removes only the
   proposal.

   **Audit — Retain (Interaction 5–7).** Compact structural labels, propagated
   annotation state, and immutable source-edit proposals make block feedback
   understandable without mutating the reviewed file. Evidence:
   [brand contract tests](test/brand.test.ts),
   [source-panel tests](test/source-panel.test.ts), and
   [source-edit tests](test/source-edits.test.ts).
8. **The selection remains visible while reading forward.** Once the selected
   row scrolls above the document viewport, a non-interactive mirror stays
   pinned at the top. Content scrolls beneath its opaque background and shadow;
   a small centered accent triangle distinguishes the pinned state. The pinned
   row's top hairline replaces the document header's bottom hairline rather than
   rendering as a fuzzy pair.
9. **Hover and selection bands are square and full-bleed.** Rows retain content
   indentation but their backgrounds and top/bottom borders reach the left edge
   of the pane. There are no side borders or rounded corners. A small,
   pointer-inert overlay completes the active band over the native scrollbar;
   pinned rows sit above the entire scroll surface. The document pane's right
   divider uses the same hairline color as selected rows.
10. **Pane headers are compact and geometrically shared.** Both use the same
    fixed 40-pixel height and aligned bottom border. Their pane labels sit in
    the top-left corner, the selected block descriptor is centered, and status
    pills remain right-aligned.
11. **Pane focus is an external top-edge signal.** The focused pane replaces
    its one-pixel header-top hairline with a four-pixel accent line extending
    upward, so its bottom edge remains aligned with the other pane's hairline.
    No green outline surrounds the pane.
12. **Navigation help is inset from the scrollbar.** Its right-side gap from
   the scrollbar visually matches its bottom gap from the window.

    **Audit — Retain (Interaction 8–12).** These details form the landed visual
    focus and reading contract; broader keyboard and VoiceOver acceptance remains
    planned under issues [#15](https://github.com/lastobelus/markover/issues/15)
    and [#91](https://github.com/lastobelus/markover/issues/91). Evidence:
    [selected-location tests](test/selected-location.test.ts) and
    [brand contract tests](test/brand.test.ts).
13. **Annotation typing does not rebuild the tree per character.** The document
   tree only rerenders when a block crosses the annotated/unannotated boundary,
   and that rerender preserves `scrollTop`. Browser scroll anchoring is disabled
   for the tree so feedback entry cannot walk the document one block at a time.

    **Audit — Retain.** The optimization protects editing continuity without
    changing persisted review semantics. Evidence:
    [brand contract tests](test/brand.test.ts).
14. **An incoming managed review joins the inbox before Markover decides whether
    to activate it.** Agent-created reviews and user-opened review links have
    separate `never`, `always`, `warn`, and `when-idle` policies. Agent arrivals
    default to `never`; explicit links default to `always`. With no active
    document either source opens immediately. Idle activation uses the focus
    state before a link brings Markover forward and requires Markover to have
    remained in the background for the configured one-to-sixty-minute interval.
    Deferred requests remain visible and consolidate prompts around the newest
    review.

    **Audit — Retain.** Separating ingestion from activation prevents an agent's
    background work from silently replacing the document a user is reading while
    keeping every arrival recoverable. Evidence: the
    [incoming-review policy](src/incoming-review-policy.ts),
    [settings defaults](src/settings.ts), and
    [policy tests](test/incoming-review-policy.test.ts).

## Screenshot attachments

1. **Pasted screenshots are managed-review files, not JSON payloads.** Each
   managed review stores them under its directory in Markover's per-user
   application data. Native **Open Markdown…** first creates a managed review,
   so its attachments use the same storage and cleanup lifecycle. Emitted paths
   are absolute so a same-machine agent can inspect them directly.

   **Audit — Retain.** Same-machine file references keep handoffs compact, and
   the obsolete blocking-review directory and attachment override have been
   removed. Evidence:
   [review-store attachment tests](test/review-store.test.ts).
2. **Attachments and prose remain separate data.** A node gains an ordered
   `attachments` array only when an image is pasted. Each entry contains an ID,
   type, MIME type, absolute path, byte checksum, pixel dimensions, and optional
   short label. The original pasted PNG or JPEG bytes are written unchanged.
3. **Pasting also inserts a convenient textual reference.** Markover inserts
   `[!img-N]` at the feedback cursor after saving an image. The attachment array
   is authoritative: deleting or editing the marker does not affect the image.
   Removing an attachment through the UI also removes exact matching markers.
   If the browser paste event exposes no image item, Markover falls back to
   Electron's native clipboard image so copies from Preview and Finder work.
4. **The first-cut UI supports ordered multiple images.** Thumbnails appear
   below feedback in paste order and wrap into rows without horizontal
   scrolling. Each card places a 78-by-42-pixel thumbnail above its short label
   and delete button. A normal click opens a large preview; Control-click
   anywhere on the attachment card replaces its label with an inline editor.
   On macOS the equivalent context-menu event follows the same path because a
   physical Control-click may not retain `ctrlKey` on the pointer event.
   Enter or blur commits, while Escape cancels. Holding Control suppresses the
   delete hover/action. Relabeling replaces matching `[!img-N]` references with
   `[!label]` in the feedback. A small `▧` after the annotation markers shows
   which document subtrees contain images.
5. **There is no image editor or dedicated caption field.** Pasted images are
   not cropped, drawn on, highlighted, or recompressed. Short thumbnail labels
   aid reference; explanatory prose remains in `feedback`.

   **Audit — Retain (Screenshot attachments 2–5).** Separate authoritative
   metadata plus unchanged image bytes supports ordered, inspectable evidence
   without expanding Markover into an image editor. Evidence:
   [review-store attachment tests](test/review-store.test.ts),
   [annotation rendering tests](test/annotation-block.test.ts), and
   [image-preview tests](test/image-preview.test.ts).
6. **Managed attachment removal and cleanup are recoverable operations.**
   Removing an attachment from a managed review first persists the
   reference-free tree, then moves the owned file to Trash, and restores the
   prior tree if Trash rejects the file. Clean Up Unused Attachments reports
   count and size, ignores invalid or unreadable managed reviews, and rescans
   before moving generated unreferenced files to Trash.

   **Audit — Retain.** Guarded managed cleanup does not sweep unknown files or
   touch the original Markdown source. The application no longer has a separate
   prototype attachment lifecycle. Evidence:
   [review-store cleanup tests](test/review-store.test.ts) and
   [PR #106](https://github.com/lastobelus/markover/pull/106).

## Agent handoff

1. **The primary integration is non-blocking `open` plus one-shot `get`.**
   `markover open <path> --summary <text>` registers the exact source in the
   existing application instance, returns a review ID, and exits. After the user
   says “Check Markover,” `markover get <id>` returns the complete review
   without agent polling or clipboard transfer.

   **Audit — Retain.** This product-independent machine interface supports
   concurrent threads without holding an agent process open. Evidence:
   [CLI implementation](scripts/markover.ts) and
   [CLI tests](test/markover-cli.test.ts).
2. **A review ID represents one review session.** Opening the same source twice
   creates distinct IDs because branch, pull request, agent thread, purpose, and
   annotations may differ. Source checksums identify the exact Markdown target;
   review ID plus block ID identifies one annotation.
3. **Handoff is atomic and idempotent.** `get` freezes the renderer before
   capturing its latest state, waits for active attachment mutations, persists
   the snapshot, transitions to `pending-agent`, and acknowledges the read-only
   UI before returning. Per-review action serialization prevents concurrent
   `get` and `edit` from interleaving.
4. **The user can reopen editing.** `markover edit <id>` idempotently returns a
   pending review to `editing`. It cannot recall work an agent already performed
   from an older snapshot, so the user must also tell that agent to pause.
5. **Stdout is a strict machine interface.** Agent-facing commands emit exactly
   one JSON value on success. Diagnostics belong on stderr, and failures exit
   non-zero without contaminating stdout.

   **Audit — Retain (Agent handoff 2–5).** Per-session identity, serialized
   state transitions, explicit reopening, and JSON-only stdout make handoff
   deterministic for concurrent agents. Evidence:
   [review-store tests](test/review-store.test.ts),
   [local-service tests](test/local-service.test.ts), and
   [CLI tests](test/markover-cli.test.ts).
6. **Clipboard export remains an escape hatch.** `Copy feedback JSON` copies the
   same complete tree. A concise-feedback format remains omitted because
   annotations are substantially less useful without their source and tree
   context.

   **Audit — Retain.** Full JSON is a useful manual recovery path, but the
   primary contract remains authenticated `get`; no second concise schema is
   warranted. Evidence: [renderer UI](src/index.html) and Agent handoff 1–5.
7. **Image handoff uses ordinary paths.** Full-tree JSON includes attachment
   metadata directly on annotated nodes; image bytes remain outside JSON.

   **Audit — Retain.** Local paths preserve original bytes and let an authorized
   same-machine agent choose when to inspect them. Evidence:
   [review-store attachment tests](test/review-store.test.ts).
8. **One agent handoff command family is supported.** Durable, non-blocking
   `markover open/get/edit` is the only agent-facing review lifecycle. The
   blocking `review` and detached `review:open`/`--resume` prototypes do not
   ship as scripts or runtime modes.

   **Audit — Retain.** One addressed lifecycle keeps storage, attachments,
   restoration, and agent guidance under the same contract. Evidence:
   [CLI tests](test/markover-cli.test.ts) and
   [local-service tests](test/local-service.test.ts).
9. **A successful `open` returns an instance-specific review deep link.** The
   canonical form is `markover://review/<id>`; isolated development instances
   use their own explicit schemes. Links focus Markover and apply the user's
   review-link activation policy without mutating the review. Because agent
   hosts may not dispatch custom schemes, the standalone
   `open '<reviewUrl>'` Terminal command is the reliable handoff.

   **Audit — Retain.** The complete activation path landed under issue
   [#52](https://github.com/lastobelus/markover/issues/52), with URL grammar and
   activation behavior covered by
   [deep-link contract tests](test/review-deep-link-contract.test.ts).

## Multi-document application state

1. **One Markover application instance owns a review inbox.** A shared per-user
   endpoint record points agent CLIs from any checkout to its small loopback JSON
   API. Electron's single-instance lock prevents duplicate owners. Startup retry
   stays inside the CLI process and does not spend agent turns polling.
2. **Every managed review has an independent tab.** Switching tabs preserves
   selection, collapsed blocks, annotations, and attachment previews.
   Control-Tab and Control-Shift-Tab cycle reviews.
3. **Pending reviews are localized read-only state.** Tabs show `WITH AGENT`,
   the annotation pane shows `WITH AGENT · READ ONLY`, feedback renders as
   Markdown rather than a textarea, and mutation controls disappear. Document
   navigation, collapsing, source, thumbnails, and image preview remain.
4. **The main process owns the latest persisted snapshot.** Renderer snapshot
   and status acknowledgements form explicit barriers around handoff. Incomplete
   or legacy review directories are left untouched rather than silently
   migrated into the managed registry.

   **Audit — Retain (Multi-document application state 1–4).** One addressed
   owner plus isolated session state prevents checkout and thread collisions;
   preserved unknown data follows the repository's no-speculative-migration
   policy. Evidence: [review-session tests](test/review-sessions.test.ts),
   [instance tests](test/instance.test.ts), and
   [review-store tests](test/review-store.test.ts).
5. **Whole-review deletion moves the self-contained managed-review directory to
   Trash.** The main process owns confirmation, path resolution, save barriers,
   and the destructive operation. Editing and pending-agent reviews are both
   deletable, with a stronger warning while an agent owns the handoff; deleting
   a review never changes or deletes its original Markdown file.

   **Audit — Retain.** Recoverable directory-level deletion preserves a simple
   ownership boundary and avoids an internal second trash lifecycle. Evidence:
   [review-store deletion tests](test/review-store.test.ts),
   [application-menu tests](test/app-menu.test.ts), and
   [PR #106](https://github.com/lastobelus/markover/pull/106).

## Review metadata

1. **Metadata belongs to the review envelope, not the deterministic tree
   structure.** A short Markdown `contextSummary` is required. Git, pull-request,
   and agent-thread fields may be absent without blocking review creation.
2. **Explicit metadata wins.** `--branch`, `--pr`, and `--thread-id` supply
   values known by the launching agent. Provenance is stored with the values.
3. **Git discovery is best effort.** Markover uses the source directory to
   discover repository root, origin, branch, and commit. Remote URL userinfo,
   query strings, and fragments are removed before persistence.
4. **Codex discovery uses a bounded exact marker search.** A
   `mko_handoff_<high-entropy>` key can identify the launching session when the
   shell lacks its thread ID. Markover examines only a fixed number of recent
   session-log tails within a fixed byte budget. Missing, unreadable, invalid,
   substring-only, or ambiguous matches degrade to unknown metadata.
5. **Metadata stays discoverable rather than crowded into the main UI.** Tabs
   show only document, review ID suffix, and status. An information button opens
   a drawer containing the summary, paths, Git details, pull request, thread,
   and discovery provenance.

   **Audit — Retain (Review metadata 1–5).** Required purpose plus explicit-first,
   bounded best-effort provenance aids handoff without making local session
   scanning mandatory or crowding navigation. Evidence:
   [metadata-discovery tests](test/metadata-discovery.test.ts),
   [CLI tests](test/markover-cli.test.ts), and
   [review-session tests](test/review-sessions.test.ts).

## Electron privilege boundary

1. **The packaged renderer is sandboxed and capability-minimal.** Context
   isolation and web security remain enabled; Node integration and webviews are
   disabled. Navigation, redirects, new windows, webview attachment, permission
   checks, and permission requests are denied. The Content Security Policy
   admits only the bundled UI and the local image sources Markover currently
   requires.
2. **Renderer-to-main IPC is guarded before side effects.** Every privileged
   invoke and one-way message must come from the active window's main frame at
   the exact canonical entry URL and must match the channel's runtime schema and
   arity. Invalid invokes reject; invalid one-way messages are dropped and
   diagnosed without processing their payload.
3. **The preload is a narrow validated bridge.** It exposes purpose-specific
   methods rather than Electron objects and validates main-to-renderer payloads
   before delivery. Packaged fuses disable RunAsNode, Node-options environment
   handling, and CLI inspection while enforcing cookie encryption, embedded
   ASAR integrity, and ASAR-only application loading.

   **Audit — Retain (Electron privilege boundary 1–3).** These controls close
   the focused-preview hardening gate while preserving only the capabilities
   Markover exercises. Issue
   [#95](https://github.com/lastobelus/markover/issues/95) owns the planned move
   away from the remaining renderer `file:` origin and privilege. Evidence:
   [IPC security](src/ipc-security.ts), [IPC contracts](src/ipc-contract.ts),
   [IPC security tests](test/ipc-security.test.ts), and
   [renderer security tests](test/renderer-security.test.ts).

## macOS release trust

1. **The current trust mode is explicit hardened ad-hoc signing.** Packaging
   requires `--trust-mode=ad-hoc`; missing and unknown modes fail closed.
   `@electron/osx-sign` signs inside-out after all bundle mutations. Identity
   lookup, timestamping, entitlement automation, and provisioning-profile
   embedding are disabled for the `-` identity.
2. **Entitlements are checked-in, component-specific, and minimal.** The main,
   generic helper, GPU helper, and renderer helper receive only
   `com.apple.security.cs.allow-jit`. The unused plugin helper and other signed
   code receive an empty profile. Device, personal-information, unsigned-memory,
   and disabled-library-validation grants are rejected by tests and final
   artifact verification.

   **Audit — Retain current boundary (macOS release trust 1–2).** Explicit
   fail-closed trust selection and minimal checked-in entitlements make the
   ad-hoc preview claim verifiable; issue
   [#13](https://github.com/lastobelus/markover/issues/13) owns the separate
   Apple-verified transition. Evidence:
   [macOS packaging tests](test/macos-package.test.ts) and
   [artifact preflight tests](test/macos-artifact-preflight.test.ts).
3. **The release contract starts at macOS 14 Sonoma and currently publishes
   Apple Silicon only.** Packaging keeps separate native architecture
   primitives and writes `LSMinimumSystemVersion = 14.0`; release preflight and
   bootstrap require the declared architecture and floor. Native Intel release
   activation and physical evidence are deferred to issue #80 at Broad
   announcement.

   **Audit — Retain current boundary; planned expansion.** Sonoma remains the
   explicit floor, while issue
   [#80](https://github.com/lastobelus/markover/issues/80) owns native Intel
   publication and physical validation before broad announcement. Evidence:
   [release contract tests](test/release.test.ts).
4. **The exact final ZIP is the release-verification boundary.** Native
   preflight verifies its checksum, safe extraction, app and helper IDs,
   version, architecture, strict code seal, hardened-runtime flags, exact
   entitlements, ad-hoc signature, absent Team ID, and expected Gatekeeper
   rejection before upload.
5. **First installation validates before cache promotion.** The dependency-free
   bootstrap checks the downloaded digest, metadata, architecture, strict seal,
   hardened runtime, and ad-hoc trust mode while the app is in staging. A
   mismatch cleans staging and prevents cache or launch. Atomic promotion
   includes a validation marker; an unmarked cache never bypasses installation
   checks. A successful install warns on stderr that Markover is not
   Apple-verified; JSON stdout remains reserved for agent protocol results.

   **Audit — Retain (macOS release trust 4–5).** Verification of the exact ZIP
   before upload and again before cache promotion prevents an unverified byte
   stream from becoming the installed candidate. Evidence:
   [artifact preflight tests](test/macos-artifact-preflight.test.ts) and
   [bootstrap tests](test/bootstrap.test.ts).
6. **Apple verification remains a separate blocked transition.** Developer ID
   signing, notarization, stapling, and successful Gatekeeper assessment require
   Apple Developer Program access and a separately reviewed explicit trust-mode
   change. Credentials alone never activate or downgrade a release path.

   **Audit — Planned replacement.** Ad-hoc trust cannot satisfy the broad gate;
   issue [#13](https://github.com/lastobelus/markover/issues/13) owns explicit
   Developer ID signing, notarization, stapling, and Gatekeeper evidence.
7. **Minimum-Node and packaged smoke run only for tagged release candidates.**
   Routine pull request and `main` CI run the portable checks and bundled
   Electron smoke on Node 24 Linux. The tag-triggered release workflow first
   tests the exact candidate on the minimum-supported Node 22.13.0, then builds
   the exact Apple Silicon ZIP, verifies it, exercises the packaged review
   lifecycle, and retains its native smoke evidence. Intel release qualification
   remains deferred to issue #80.

   **Audit — Retain.** Candidate-only minimum-version and native validation
   preserves support-floor and release-byte evidence without duplicating those
   slower lanes on every non-candidate commit. Evidence:
   [continuous integration](.github/workflows/ci.yml), the
   [release workflow](.github/workflows/release.yml), and the
   [release workflow tests](test/release.test.ts).

## Release provenance and rollback

1. **Official releases are draft-first and all-or-nothing.** An unprivileged
   native job builds the Apple Silicon app while another builds the matching
   CLI. A staging job requires exactly those two payloads and their checksums
   before it can create a complete four-asset draft. Internal x64 CI is not a
   supported or published Intel release.

   **Audit — Retain current boundary; planned expansion.** Draft completeness
   is retained, while the Apple-Silicon-only asset set is replaced only when
   issue [#80](https://github.com/lastobelus/markover/issues/80) lands verified
   native Intel releases. Evidence:
   [release workflow tests](test/release.test.ts).
2. **Draft staging and publication are distinct protected operations.** The
   `release` environment gates both jobs. The first approval admits the oldest
   pending tag to rollback selection and complete draft assembly; the second
   follows exact-draft inspection and admits publication. This retains every
   pending release without Actions concurrency's replaceable pending slot. The
   final transition refetches the mutable draft by release ID and proves every
   byte, release-note field, asset name, and rollback target is still unchanged
   immediately before publishing.
3. **GitHub attestations and SHA-256 sidecars have separate jobs.** Sidecars
   provide simple byte checks. GitHub build-provenance attestations identify
   the source repository and release workflow. Neither is a claim of
   bit-for-bit reproducibility.
4. **Stable version tags only move forward and never move in place.** The
   release workflow accepts stable SemVer tags whose matching package versions
   are newer than every preserved stable tag, contained in protected `main`,
   and already green on the required `Verify (Node 24)` CI check. The
   tag-triggered release workflow tests that exact candidate on the
   minimum-supported Node 22.13.0 before draft assembly. Repository rules
   restrict `v*` creation and separately prohibit updates and deletion without
   bypass.

   **Audit — Retain (Release provenance and rollback 2–4).** Protected,
   separately approved publication plus attestations, sidecars, and immutable
   monotonic tags make source and release bytes independently inspectable.
   Evidence: [release operation tests](test/release-operations.test.ts),
   [release workflow tests](test/release.test.ts), and the
   [release runbook](docs/developer/releasing.md).
5. **Each release carries its own rollback contract.** Generated notes name one
   stable release explicitly designated `latest` as the known-good version and
   provide its exact version-pinned launcher. Monotonic version checks still
   compare against every preserved stable tag, including withdrawals. Users
   quit Markover and back up the complete Application Support directory first;
   rollback is promised only within one review-data format.
6. **Published bytes are withdrawn, never replaced.** A defective version is
   marked withdrawn, `latest` returns to the named known-good release, and a
   fix receives a new version. Deleting an actively dangerous immutable release
   is an exceptional documented incident action; its tag is never reused.

   **Audit — Retain (Release provenance and rollback 5–6).** Version-pinned
   rollback and withdrawal preserve an auditable lineage without rewriting
   published artifacts. Issue
   [#99](https://github.com/lastobelus/markover/issues/99) owns the review-format
   boundary assumed by rollback, and issue
   [#92](https://github.com/lastobelus/markover/issues/92) owns clean-profile
   broad-candidate exercise. Evidence:
   [release operation tests](test/release-operations.test.ts) and the
   [release runbook](docs/developer/releasing.md).

## Local service authorization

1. **The first authorization boundary is the local OS account.** Markover
   denies loopback callers that cannot read a protected per-process capability.
   A malicious process running as the same user and a privileged or root
   process are explicitly outside this boundary.
2. **The service remains plain HTTP on `127.0.0.1`.** Local TLS, browser-client
   support, CORS, and `Host`/`Origin` policy do not strengthen the selected
   account boundary and are not part of protocol 2.

   **Audit — Retain (Local service authorization 1–2).** A protected capability
   enforces the selected OS-account boundary; transport features that do not
   strengthen that boundary would add complexity without protection. Evidence:
   [local-service tests](test/local-service.test.ts) and
   [authorization smoke tests](test/smoke-auth.test.ts).
3. **Each service process gets one full-access identity.** Startup generates a
   random UUID instance ID and a 256-bit capability with
   `randomBytes(32).toString('base64url')`. Restarting rotates both values; no
   later process reuses an expired capability.
4. **Discovery and credentials are fixed sibling records.** `service.json`
   protocol 2 contains only `version`, `instanceId`, `port`, and `pid`.
   `service.token` protocol 1 contains `version`, the matching `instanceId`, and
   the capability. Endpoint metadata cannot redirect a client to another
   credential path.
5. **POSIX filesystem modes enforce the account boundary.** Startup hardens the
   Markover application-data directory to `0700` before imports, settings,
   windows, or service work. Both records and their atomic temporary files use
   `0600`. Publication writes the credential first and the endpoint last; a
   publication failure closes the listener and fails startup. Windows ACL
   support and Windows security claims are deferred.
6. **Shutdown leaves one coherent stale pair.** Neither record is deleted on
   graceful shutdown. Stale records are useful to startup recovery and reveal
   no live credential once their owning process has stopped.

   **Audit — Retain (Local service authorization 3–6).** Per-process rotation,
   fixed sibling records, restrictive filesystem modes, and coherent stale
   state provide recoverable discovery without persisting a live capability.
   Evidence: [service-endpoint tests](test/service-endpoint.test.ts) and
   [local-service tests](test/local-service.test.ts).
7. **Only exact `GET /health` is public.** It returns `status`, protocol version
   2, and the service's non-secret instance ID. Every other request must
   authenticate before route matching or body reading with exactly one
   Authorization field. The Bearer scheme is case-insensitive and permits one
   or more spaces as HTTP specifies; the capability retains its exact
   43-character base64url shape, and the client emits the canonical form.
8. **Authorization failures do not become an oracle.** Missing, malformed,
   duplicated, and incorrect credentials all return the same structured
   `401 UNAUTHORIZED` response and Bearer challenge. Validly shaped tokens use
   a constant-time comparison. Unknown routes are also gated before their
   `404`, and unauthorized bodies never reach JSON parsing or state mutation.
9. **The shared client owns credential propagation and preflight.** For every
   non-health request it reads fresh endpoint metadata and credentials, requires
   matching record IDs, then calls public health without a token and requires
   the listener's instance ID to match. Only then does it send the Bearer
   capability and application request. Callers neither pass nor receive tokens,
   and successful preflight is not cached.
10. **Client failures have stable, non-secret categories.** Invalid discovery
    metadata is `INVALID_ENDPOINT`; missing or malformed credentials are
    `INVALID_CREDENTIAL`; mismatched record or health IDs are `STALE_SERVICE`;
    an identity-matched request rejected by the server is `UNAUTHORIZED`;
    preflight network failure is `SERVICE_UNAVAILABLE`; and an application
    transport failure is `REQUEST_UNCERTAIN`.
11. **Rejected-request diagnostics are explicit and redacted.** They are off by
    default and controlled by the live persisted “Log rejected API requests”
    setting. Enabled lines contain only method, query-free pathname, and
    `missing`, `malformed`, or `mismatch`; they never contain credentials,
    fingerprints, queries, bodies, other headers, or remote addresses.
12. **Protocol 2 is a clean pre-preview break.** There is no protocol-1
    fallback, dual protocol, optional authentication, or historical-review
    migration. Existing review JSON and attachments remain untouched and need
    not be openable by the latest app. Restarts do not require draining review
    handoffs; issue 39 independently owns bounded-loss restart durability.

    **Audit — Retain (Local service authorization 7–12).** Authentication before
    parsing or routing, fresh client preflight, stable redacted failures, and a
    clean protocol break form one testable fail-closed boundary. Evidence:
    [local-service tests](test/local-service.test.ts),
    [service-endpoint tests](test/service-endpoint.test.ts), and
    [authorization smoke tests](test/smoke-auth.test.ts).
13. **Issue 12 landed as a three-PR stack.** PR 1 established capability
    generation, protected publication, server enforcement, minimum client
    propagation, and the reusable development smoke fixture. PR 2 added bounded
    record convergence, ordinary stale-instance detection, in-place record
    repair, and deterministic client recovery. PR 3 added exhaustive adversarial
    verification and public privacy/data claims.

    **Audit — Superseded delivery plan.** Issue
    [#12](https://github.com/lastobelus/markover/issues/12) is closed and these
    slices are historical provenance, not unfinished current ownership.
14. **Publication recovery is bounded and non-destructive.** Record reads retry
    missing, malformed, or mismatched pairs for a short fixed convergence
    window. When complete probing still fails, the CLI invokes one normal
    launch-or-notify operation. A stopped primary starts normally; a ready
    primary serially republishes the same in-memory identity and listener. The
    CLI never deletes records, kills a PID, or forcibly replaces a process.
15. **The health instance ID is a consistency name tag, not authentication.**
    It prevents an ordinary unrelated stale-port listener from receiving the
    capability or review request. A malicious process that observes the public
    ID and deliberately impersonates the stale listener remains outside the
    implemented protection; HMAC handshakes, connection pinning, local TLS, and
    Unix-domain sockets are deferred until real deployment evidence justifies
    them.
16. **Ambiguous application requests are never replayed automatically.**
    Recovery completes before transmission. Once an application request may
    have reached a listener, transport failure tells the user to inspect
    Markover before retrying. Automatic retries require a separately designed
    idempotency contract.
17. **Authorization evidence uses a layered real-HTTP matrix.** Every current
    protected route is denied with missing and validly-shaped incorrect
    credentials, while every hostile credential class is exercised against a
    representative mutation. Unauthorized requests stop before routing, body
    parsing, callbacks, or state changes. Unknown routes authenticate before
    `404`; tests do not invent attachment or deletion APIs that do not exist.

    **Audit — Retain (Local service authorization 14–17).** Bounded
    non-destructive recovery and no automatic replay preserve ambiguous user
    state, while the real-HTTP matrix verifies rejection before mutation.
    Evidence: [service-endpoint tests](test/service-endpoint.test.ts),
    [local-service tests](test/local-service.test.ts), and
    [authorization smoke tests](test/smoke-auth.test.ts).
18. **Local session discovery is visible and controllable.** The default-on
    “Discover agent thread from local session logs” setting controls only
    handoff-key-based Codex session scanning. Explicit thread IDs and Git
    provenance remain available. The CLI reads the shared per-user setting
    without adding a service route; a missing file uses the default, while an
    existing malformed or unreadable file skips scanning. Opt-out is silent and
    never prevents a review from opening.
19. **Public privacy claims distinguish local storage from safe sharing.** The
    public page names stored review content, attachments, local paths, Git and
    agent provenance, storage locations, recoverable in-app managed-review
    deletion and managed-attachment cleanup, and the manual complete-reset
    boundary. Source-edit proposals and managed-review deletion do not mutate
    the original Markdown. Reviews remain local to the macOS account, but
    same-user and privileged processes remain inside the trust boundary.
20. **Network and handoff boundaries are explicit.** Ordinary review handling
    has no telemetry, analytics, cloud sync, or automatic review upload.
    Installation can contact npm or GitHub, and explicitly previewing a remote
    Markdown image contacts its host; the image remains inert before that
    action. After an authenticated agent retrieves a handoff, the recipient's
    storage, logging, and network behavior is outside Markover's control.

    **Audit — Retain (Local service authorization 18–20).** Controllable local
    discovery and explicit privacy/network claims keep optional provenance from
    becoming hidden data collection or an implied recipient guarantee. Evidence:
    [metadata-discovery tests](test/metadata-discovery.test.ts),
    [settings tests](test/settings.test.ts), and
    [public-site tests](test/docs-site.test.ts).
21. **Issue 12 closed at the verified authorization boundary.** Issue 39 owns
    bounded-loss durability, issue 13 owns packaged happy-path smoke, issue 9
    owns broader preview documentation and cleanup guidance, issue 15 owns
    deletion, and issue 64 owns the future in-app privacy link. The final slice
    does not absorb those roadmapped responsibilities.

    **Audit — Superseded coordination note.** The ownership split remains useful
    history. Issues [#9](https://github.com/lastobelus/markover/issues/9) and
    [#39](https://github.com/lastobelus/markover/issues/39) are complete; issues
    [#13](https://github.com/lastobelus/markover/issues/13),
    [#15](https://github.com/lastobelus/markover/issues/15), and
    [#64](https://github.com/lastobelus/markover/issues/64) retain their current
    release, compatibility/accessibility, and Help-surface work.

## Planned and deferred boundaries

- **Deferred — Compound-block drill-down.** Block quotes and tables remain
  selectable opaque source ranges; rows, cells, and nested quote blocks do not
  justify additional tree depth yet. Issue
  [#15](https://github.com/lastobelus/markover/issues/15) owns publishing this
  boundary. Evidence: [tree tests](test/tree.test.ts).
- **Deferred — Markdown extension nodes.** Footnotes, definition lists,
  strikethrough, containers, and other non-enabled extensions continue to
  degrade through the current parser instead of creating a second grammar.
  Issue [#15](https://github.com/lastobelus/markover/issues/15) owns the public
  compatibility matrix. Evidence: [extension-degradation tests](test/tree.test.ts).
- **Deferred — Unsupported-syntax UI.** Explicit warnings and selectable
  fallback nodes are not required while exact source is preserved and #15
  publishes the supported boundary; usage evidence can justify a later design.
  Evidence: Data and parsing 8 and [tree tests](test/tree.test.ts).
- **Deferred — Cross-revision annotation migration.** Import, merge, migration,
  and block matching across edited documents conflict with the current
  exact-source identity model and are not required for broad launch. Evidence:
  [review-store immutability tests](test/review-store.test.ts).
- **Retain — Manual document opening creates a managed review.** The empty state
  and File > Open Markdown expose a native file picker. Each successful choice
  becomes an atomic managed review with a local-review context, appears in the
  Documents list and tabs, restores after restart, and leaves its original
  Markdown file untouched. Cancellation, snapshot mismatch, discovery failure,
  and storage failure do not create a transient renderer-only fallback.
  Evidence: the [local-review boundary](src/local-review.ts),
  [local-review tests](test/local-review.test.ts), and issue
  [#107](https://github.com/lastobelus/markover/issues/107).
- **Retain — Minimal agent lifecycle writeback.** A handoff remains immutable,
  but the agent explicitly marks the whole review `revised` after acting on all
  feedback. A verified PR merge marks every associated local review `done`.
  Per-annotation outcomes remain outside this lifecycle protocol. Issue
  [#123](https://github.com/lastobelus/markover/issues/123) owns the transition;
  issue [#128](https://github.com/lastobelus/markover/issues/128) defers review
  lineage and version ordinals.
- **Planned — Review history and remaining readiness.** Recoverable review
  deletion and unused-attachment cleanup landed in PR #106. Issue
  [#97](https://github.com/lastobelus/markover/issues/97) owns inbox/history
  organization; issue [#15](https://github.com/lastobelus/markover/issues/15)
  retains Markdown compatibility and accessibility remediation.
- **Deferred — Markover-owned pull-request refresh.** Agents opportunistically
  supply timestamped PR lifecycle observations during review commands; Markover
  stores them without owning GitHub credentials or polling. Issue
  [#126](https://github.com/lastobelus/markover/issues/126) owns an optional
  GitHub connection for authoritative refresh. Evidence:
  [metadata-discovery tests](test/metadata-discovery.test.ts).
- **Deferred — Stronger local-adversary isolation.** Same-user and privileged
  process isolation plus deliberate stale-port impersonation protection remain
  outside the selected OS-account boundary until deployment evidence justifies
  a stronger transport. Evidence: Local service authorization 1, 2, and 15 and
  [authorization tests](test/local-service.test.ts).
- **Planned — Accessibility acceptance.** Issues
  [#15](https://github.com/lastobelus/markover/issues/15) and
  [#91](https://github.com/lastobelus/markover/issues/91) own keyboard,
  VoiceOver, and clean-profile broad-candidate evidence.
- **Planned — Apple-verified releases.** Issue
  [#13](https://github.com/lastobelus/markover/issues/13) owns Developer ID
  signing, notarization, stapling, and Gatekeeper success.
- **Deferred — App Sandbox and automatic updates.** Neither is part of the
  current direct-download release contract; adopting either requires its own
  capability and update-integrity design rather than being implied by signing.
  Evidence: [macOS packaging tests](test/macos-package.test.ts) and the
  [release runbook](docs/developer/releasing.md).
- **Planned — Handoff format compatibility.** Issue
  [#99](https://github.com/lastobelus/markover/issues/99) owns the versioning and
  reader contract for `markover-review` without speculative compatibility
  layers or historical-data migration.

## Broad-announcement conclusion

**No-go as of 2026-08-09 against `main` commit `51f175f`.** The landed product
has a coherent exact-source review model, durable multi-agent handoff, explicit
local authorization boundary, and verifiable ad-hoc release path. Broad
announcement remains blocked because issue
[#5](https://github.com/lastobelus/markover/issues/5) requires the focused-preview
gate and every broad-launch evidence category to complete first.

The remaining gates are grouped by outcome:

- **Focused-preview completion:** Final Apple Silicon candidate selection and
  clean-machine validation, public launch assets, feedback operations, and
  packaged deep-link validation remain under issues
  [#10](https://github.com/lastobelus/markover/issues/10),
  [#11](https://github.com/lastobelus/markover/issues/11),
  [#16](https://github.com/lastobelus/markover/issues/16),
  [#17](https://github.com/lastobelus/markover/issues/17), and
  [#90](https://github.com/lastobelus/markover/issues/90).
- **Broad release trust and platform evidence:** Developer ID/notarization,
  native Intel publication, clean-profile rollback, and removal of the renderer
  `file:` origin remain under issues
  [#13](https://github.com/lastobelus/markover/issues/13),
  [#80](https://github.com/lastobelus/markover/issues/80),
  [#92](https://github.com/lastobelus/markover/issues/92), and
  [#95](https://github.com/lastobelus/markover/issues/95).
- **Broad user and community readiness:** Accessibility, history and Markdown
  compatibility, native Help surfaces, guide review, and clean-profile
  keyboard/VoiceOver evidence remain under issues
  [#15](https://github.com/lastobelus/markover/issues/15),
  [#64](https://github.com/lastobelus/markover/issues/64),
  [#84](https://github.com/lastobelus/markover/issues/84), and
  [#91](https://github.com/lastobelus/markover/issues/91).
- **Broad agent and decision-contract readiness:** Evaluation automation,
  handoff-format compatibility, prototype-path retirement, and ongoing register
  reconciliation remain under issues
  [#46](https://github.com/lastobelus/markover/issues/46),
  [#99](https://github.com/lastobelus/markover/issues/99),
  [#100](https://github.com/lastobelus/markover/issues/100), and
  [#101](https://github.com/lastobelus/markover/issues/101).

A future **go** requires issue #5's checklists to be evidenced against the final
candidate, the linked gate issues above to be complete or explicitly removed
from the gate by the maintainer, and issue
[#18](https://github.com/lastobelus/markover/issues/18) to execute the staged
announcement and rollback plan.
