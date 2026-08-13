# Markover glossary

Canonical project language for communication between the maintainer and agents. Terms are alphabetized; aliases appear in definitions rather than as duplicate headings.

Every entry starts with `## term::`, so the index is available with `rg '^## .*::$' GLOSSARY.md` and a term with `rg -n -i '^## .*term.*::$' GLOSSARY.md`.

## agent handoff loop::

The normal `open` → human review → `get` → agent response → `revise` workflow, with `edit` used when the human changes a handoff before the agent finishes.

## annotated-only view::

A document-tree mode showing annotated blocks and only the unannotated ancestors needed to preserve their source hierarchy; also called the annotated filter.

## annotated projection::

The filtered tree used by annotated-only view: every annotated block plus its contextual ancestors.

## annotation::

Block-scoped reviewer feedback: nonblank Markdown feedback, one or more attachments, or both.

A source edit appears with the annotation context but does not by itself make a block annotated. The persisted field containing annotation prose is named `feedback`.

## annotation attachment::

An image file and its metadata attached to a review block; the bytes stay outside the review artifact JSON.

An attachment with no feedback text is an **attachment-only annotation**.

## annotation list::

The annotation-pane view that renders every annotation in the active review and links each one back to its review block.

## annotation marker::

A fixed-column tree-row indicator for annotation or attachment state.

An **own annotation marker** means the block itself is annotated. A **descendant annotation marker** means at least one descendant is annotated. Prefer *descendant* over *inherited* because the feedback is not inherited by the ancestor.

## annotation sneak peek::

The transient hover preview opened from a block's own annotation marker; also called the hover card or peek.

## application-data directory::

Markover's protected per-user directory containing managed reviews, attachments, settings, and local-service records.

On macOS this is `~/Library/Application Support/Markover`. Do not confuse it with a checkout-local legacy `.markover` directory.

## attachment reference::

An inline annotation token such as `[!img-2]` that refers to an attachment label.

The attachment array is authoritative; the textual reference is a convenience for discussion.

## audience root::

One of the two top-level documentation boundaries: `docs/user` for the public product workflow and `docs/developer` for contributor implementation and operations.

An explicitly labelled agent page may live in the public root when it serves the user workflow. Cross-links are optional, and deliberate repetition is preferable to making either audience read the wrong level of detail.

## babysit::

Keep watching a pull request until its current head has green CI, a terminal positive review, no unresolved threads, and a clean mergeable state.

In merge mode, finish file-changing housekeeping before merging, then reconcile related issue comments and state so the final handoff gives concrete next steps or confirms archive readiness.

## block ID::

A deterministic document-order identifier for one review block within one exact review target.

A review ID plus block ID identifies one annotation. Block IDs are not identities across source revisions.

## broad announcement::

The later public-release gate requiring distribution trust, accessibility validation, and wider-audience readiness beyond focused preview.

## canonical instance::

The user's primary long-running Markover app and review inbox, distinct from temporary development, smoke-test, or QA instances.

Agents should treat requests not to disturb, restart, foreground, or repurpose the canonical instance literally.

## capability token::

The per-service-start 256-bit bearer secret authorizing every non-health local-service route; often shortened to capability.

It rotates on restart, stays inside protected local files and the shared client, and is not a review or handoff credential.

## context drawer::

The UI surface showing the active review's summary, paths, Git context, pull request, agent thread, and discovery provenance.

## contextual ancestor::

An unannotated ancestor retained in an annotated projection to keep an annotated descendant in source context.

## credential record::

The restricted `service.token` record containing a capability token and the instance ID it belongs to; also called the token record.

## discovery commit point::

Publication of the endpoint record after the credential record, making the visible endpoint evidence that its matching credential has already been published.

## document tree::

The central UI view of the review tree as navigable, collapsible Markdown blocks.

Use **review tree** for the serialized data structure and **document tree** for its presentation and navigation surface.

## durability barrier::

An operation that must capture and persist the exact latest review state before acknowledging success.

Handoff, reopen, and graceful shutdown are durability barriers; ordinary mutations may use bounded autosave scheduling.

## done::

The persisted terminal review status indicating that the associated pull request has been verified as merged.

An agent reports the merge through the PR-scoped `done` command; Markover does not infer or poll for it.

## editing::

The persisted review status in which the human can change annotations, attachments, and source edits.

## endpoint record::

The non-secret `service.json` discovery record containing protocol version, instance ID, port, and PID.

## fixed contract::

Proposed non-editable agent guidance defining invariant feedback semantics and handoff obligations; also called the core contract.

It takes precedence over the interpretation policy.

## focused preview::

The narrow early macOS release gate for coding-agent users before broad-announcement requirements are complete.

## focus-safe open::

Opening or retrieving a review without activating Markover or taking keyboard focus; also called a background review open.

## frontmatter container::

The non-editable parent review block representing a document's complete YAML frontmatter section.

It can receive general frontmatter feedback and its source card is read-only; editable top-level pairs are frontmatter entries.

## frontmatter entry::

A review block for one line-safe top-level YAML key-value pair, preserving its exact source span.

## handoff::

The atomic transition that captures and persists the latest review artifact, freezes mutations, changes the status to `pending-agent`, and returns it to the agent.

`get` performs a handoff. Use **handoff** for the lifecycle action and **get** for the CLI command.

## handoff-in-progress::

The transient session state while Markover is capturing a handoff; it must not be persisted as a durable review status.

## handoff key::

A unique high-entropy correlation marker supplied to `open` so Markover can discover the launching T3 session when no explicit thread ID is available.

It is discovery metadata, not a review ID, capability token, or authorization mechanism.

## inflight check::

The proposed pre-edit coordination read combining In Progress roadmap items with their work-intent comments to expose overlap and missing intent.

## instance ID::

A random, non-secret identifier for one local-service process generation, carried by both service records.

A mismatch between the two records is a stale-service condition.

## interpretation policy::

Proposed user-editable per-review guidance controlling how much latitude agents use when interpreting feedback.

It can refine but cannot override the fixed contract.

## line-safe block::

A parsed construct whose editable source range covers complete, non-overlapping lines and can support an unambiguous source edit.

## live renderer smoke::

A focused automated launch of the emitted or packaged Electron app that verifies real renderer startup and a small end-to-end workflow.

It complements static bundle or ASAR layout checks; it does not replace the full test suite.

## local service::

Markover's loopback HTTP API on `127.0.0.1`, used by agent-facing commands to operate reviews in the single app instance.

## managed review::

A durable review created through the inbox protocol, identified by a review ID, stored in the application-data directory, and restored after restart.

Use this instead of **durable review**, whose older sessions sometimes meant a detached legacy review process.

## markover-ready document::

A Markdown document substantial enough to save and open in Markover for review.

Repository guidance currently uses seven meaningful Markdown blocks as the threshold; do not fragment content merely to reach it.

## mixed feedback::

One annotation containing independently actionable parts with different intents, such as a revision request and a question.

Agents must interpret each part rather than assigning one intent to the whole annotation.

## no-op source edit::

An invalid source edit whose `current` text equals its `original` text and therefore proposes no change.

## opaque block::

A review block rendered and selected as one unit even though its Markdown contains nested structure.

Block quotes and tables are currently opaque: their internals do not become navigable child blocks.

## pending-agent::

The persisted read-only review status indicating that the exact handed-off artifact is with the agent.

The UI label is **WITH AGENT · READ ONLY**. Prefer *pending-agent* for code and persisted state and *with agent* in user-facing descriptions.

## policy snapshot::

The planned effective interpretation policy copied into a review when it opens so later settings changes cannot alter that review's handoffs.

## pull-request status observation::

A timestamped `draft`, `open`, `merged`, or `closed` value supplied by an agent after a live GitHub lookup.

It records source `agent` in the review envelope. Issue #126 owns replacing these opportunistic observations with optional authoritative GitHub refresh.

## protocol 2::

The clean-break local-service protocol with capability authorization and paired endpoint and credential records.

There is no protocol-1 fallback or optional-authentication mode.

## q/a discovery::

The initial interview used to establish intent before implementing an issue, pull request, or slice.

Inspired by Matt Pocock's “grilling” skill and currently encapsulated in the [`start-issue` skill](.agents/skills/start-issue/SKILL.md). Also called issue Q&A, issue/PR interview, or simply interview.

## question acknowledgment::

The proposed rule that every reviewer question remains explicitly accounted for in the agent's user-facing response, even when it also prompted an edit.

## rendered annotation::

The shared annotation-card presentation used by the annotation list and annotation sneak peek, with mode-specific interactivity.

## review artifact::

The complete machine-readable value for one review: review envelope, exact source document, unsupported-source records, review tree, annotations, attachments, and source edits.

`get` returns the handed-off review artifact exactly; derived navigation metadata belongs outside it.

Its portable artifact family is `markover-review`. The integer `version` covers the whole portable value rather than independently versioning its subobjects.

## review block::

A selectable semantic Markdown unit in the review tree to which annotation data and a source edit can attach; often shortened to block or node.

Examples include headings, paragraphs, list items, code blocks, tables, block quotes, thematic breaks, and frontmatter entries.

## review deep link::

The `markover://review/<review-id>` URL that focuses Markover and applies the configured review-link activation policy without changing review content or lifecycle status; also called a review URL.

## review envelope::

The `review` metadata object inside a managed review artifact, containing identity, status, timestamps, context, and discovered provenance.

It is not the whole review artifact or the review tree.

## review ID::

The opaque `mko_…` identifier for one managed review, used by later `get`, `edit`, `revise`, activation, and deep-link operations.

Opening identical source twice still creates two review IDs because purpose, context, and annotations may differ.

## review import::

Bringing a legacy checkout-local review into the current per-user review store without overwriting existing managed data.

Historical artifacts that are not imported remain preserved; import is not a general format migration promise.

## review inbox::

The single multi-review Markover workspace that receives work from one or more agent threads and groups reviews by project.

## review metadata::

Portable opening-time context explaining why and where a review was opened: summary, sanitized Git hints, pull request, and agent thread.

It belongs to the review envelope, not the deterministic review target. Current machine-local evidence, discovery provenance, grouping keys, and requesting-thread-title observations are app-private enrichment rather than review metadata.

## review session::

One review plus its current lifecycle and UI state, including selection, collapse state, annotation view, and source drafts.

Avoid bare **session** when a T3 transcript or app process could also be meant.

## review store::

The durable per-user owner of managed review JSON and attachment files.

## review target::

The immutable Markdown snapshot and deterministic block structure that a review is about.

Annotations and source edits may change; the source content, checksum, block IDs, raw source, and structure may not. The `sourceDocument` object is the source portion of this target.

## review tree::

The serialized deterministic hierarchy of review blocks for one source document, including mutable annotation state.

Use **document tree** for the central UI view of this structure.

## revised::

The persisted read-only review status indicating that the agent has acted on every part of the handed-off feedback.

A later feedback round opens a new independent review; revision lineage and version ordinals are deferred to issue #128.

## roadmap status ledger::

The GitHub Project board as the authoritative coarse-grained Todo, In Progress, and Done view of project work.

Work-intent comments add coordination detail without becoming a second status system.

## selection normalization::

The deterministic adjustment of selection after a view change, preserving it when visible and otherwise moving it to the nearest valid block.

## self-contained renderer bundle::

The single emitted ESM artifact containing the renderer dependency graph, with no runtime `node_modules` URLs or ordered global dependency scripts.

## service-free help::

The machine-readable `markover help` path that reports CLI workflow and recovery guidance without starting Electron or requiring the local service.

## service record pair::

The matching endpoint and credential records describing and authorizing one local-service instance.

A pair may be coherent and live, coherent but stale, or mismatched across process generations.

## source card::

The annotation-pane panel showing a block's original source, saved source edit, diff, and edit controls.

## source document::

The exact input Markdown bundled with a review, including name, path when known, complete content, and checksum.

## source draft::

Unsaved replacement text retained while a review block's source editor is open or before its edit is committed.

## source edit::

A saved exact replacement proposal stored as `sourceEdit: { original, current }` on a review block; also called a source proposal.

It changes the block's proposed presentation and diff without rewriting the source document, checksum, raw source, IDs, or structure.

## stream contract::

The agent-facing CLI rule that success writes exactly one JSON value to stdout while diagnostics go to stderr and failures exit nonzero.

## thread-host::

The user-facing application that contains and presents an agent thread, such as T3 Code, LastCode, or the Codex app.

Use **thread-host** rather than bare *host* or *harness* in prose, and `threadHost` for typed-data and code identifiers. A thread-host is distinct from the provider that executes the thread and from a computer, hostname, network host, repository, worktree, or process.

In agent request packets, `threadHost.kind` names the application and optional `threadHost.threadId` carries a distinct thread-host-level thread identifier. When the thread-host uses the provider thread ID unchanged, the packet omits `threadHost.threadId`.

## thread-title::

The current user-visible title of an agent thread, including user renames.

A **requesting-thread-title** is the thread-title of the agent thread that requested a review. A thread-title is a mutable label, not a review title or thread identity, and must not be inferred from an original prompt or stale preview.

## truth context::

Upfront context on an ELI5 artifact stating which PR or roadmap state it describes, what is stable, and what known work may change it.

## unsupported syntax::

Markdown syntax that Markover does not map to a specialized review block.

It may remain literal, degrade into supported blocks, or appear only in the exact source document; unsupported does not mean discarded.

## work-intent comment::

One proposed marked issue comment describing a thread's phase, intended slice, likely touch points, dependencies, blockers, branch, and optional thread ID.

It supplements the roadmap status ledger so parallel agents can coordinate before editing.
