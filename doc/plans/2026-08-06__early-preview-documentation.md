# Issue #9 early-preview documentation plan

## Status and truth context

This is the accepted implementation plan for [issue #9](https://github.com/lastobelus/markover/issues/9), **Publish preview, privacy, storage, deletion, and support documentation**. The issue is in the **Focused preview** milestone and the **Markover Announcement Readiness** project.

The plan records the issue interview completed on August 6, 2026, the audience-segregation decision added on August 7, and the tested durability evidence merged through [issue #39](https://github.com/lastobelus/markover/issues/39). Its stable center is the two-audience documentation architecture, public maturity label, current Apple Silicon release boundary, support model, cleanup scope, and two-checkpoint delivery.

## Outcome

A prospective user can understand Markover's product promise, early-preview status, requirements, compatibility boundary, local-data behavior, cleanup path, and support channel in under two minutes without encountering contributor or agent-operational detail.

A developer or contributor has a separate technical documentation root for building, testing, releasing, debugging, and understanding Markover's implementation. Each audience can follow an explicit cross-link when the other perspective is useful, but neither audience must sort through the other audience's material to complete its normal work.

An agent has one explicitly labelled public workflow page for opening, waiting, retrieving, reopening, and interpreting a review. Human user pages explain the corresponding choices and consequences without embedding those commands or agent policies.

## Audience contract

Documentation has two explicit roots inside `docs/`:

- **`docs/user/` — user documentation.** This is the source for the deployed public documentation site. It answers what Markover does, whether and how to try it, what data and compatibility consequences matter, how to recover or clean up, what limitations apply, and where to get help.
- **`docs/developer/` — developer and contributor documentation.** This is repository documentation for architecture, protocols, schemas, threat-model mechanics, development setup, tests, packaging, release operations, and maintenance procedures. It is not included in the GitHub Pages artifact.

The deployed root contains a dedicated `docs/user/agents/` page because agents participate in the public product workflow. This is an audience-labelled page, not a third documentation root: the human guide links to it instead of mixing exact CLI steps and interpretation policies into the user's reading path.

Audience ownership is determined by the reader's decision, not by where a fact was first documented:

- A user-facing page includes a technical fact only when it changes a user's choice, action, risk, or recovery path.
- A developer-facing page carries the mechanism, invariants, diagnostic detail, evidence, and maintenance procedure required to keep the user promise true.
- A user page may link to a clearly labelled technical explanation. A developer page may link to the user-facing contract it implements.
- Deliberate repetition is preferable to shared fragments, transclusion, or prose indirection that makes either audience read the wrong level of detail.
- Repeated claims must agree semantically, but may use different language and depth for each audience.

The repository `README.md` remains a short product and user entry point with a clearly labelled install-free agent section, a link to the public agent workflow, and one separated contributor link into `docs/developer/`. `CONTRIBUTING.md` enters through the developer root; repository agent guidance and the public agent page carry agent procedures without sending agents through the human guide.

## Public contract

| Topic | Accepted user-facing position |
| --- | --- |
| Maturity | **Early macOS preview** is the canonical label. “Focused preview” remains an internal roadmap term. |
| Platform | macOS 14 Sonoma or newer on Apple Silicon Macs. Native Intel releases are deferred to [issue #80](https://github.com/lastobelus/markover/issues/80) for the Broad announcement. |
| Launcher | Node.js 22.13.0 or newer. |
| Review format | Early-preview review formats may change without migration guarantees. Stored historical JSON and attachments are preserved, but a newer Markover version may not open every older review. |
| Privacy | Ordinary review work stays in the current macOS account. There is no telemetry, analytics, cloud sync, or automatic review upload. User-triggered install/update, remote-image preview, and agent handoff have explicit boundaries. |
| Local API | Markover protects its local API with a per-process secret stored inside the current macOS account boundary. Other processes running as the same user and administrators remain inside that trust boundary. Exact protocol and filesystem mechanics belong in developer documentation. |
| Support | GitHub Discussions is the general support channel. Reproducible defects use the bug form; suspected vulnerabilities use private reporting. |
| Durability | While Markover is responsive and local storage is healthy, managed changes have a tested two-second default app-process-crash window. Power loss, OS or hardware failure, and unhealthy or unusually slow storage are excluded. |

## Documentation architecture

### Repository and deployment layout

Checkpoint 1 establishes this layout directly:

```text
docs/
├── user/
│   ├── index.html
│   ├── guide/
│   ├── agents/
│   ├── privacy/
│   ├── limitations/
│   ├── assets/
│   ├── site.ts
│   └── styles.css
└── developer/
    ├── README.md
    ├── development.md
    ├── releasing.md
    └── local-service-security.md
```

`docs/user/` becomes the GitHub Pages source root. TypeScript continues to emit the site script under `build/docs/user/`, and the Pages workflow uploads `build/docs/user` as the artifact root. Public URLs are `/`, `/guide/`, `/agents/`, `/privacy/`, and `/limitations/`; `/user/` does not appear in public URLs.

`docs/developer/` remains available through the repository and is excluded from the Pages artifact. Existing links and tests move to the new source paths in the same checkpoint. Because Markover is pre-MVP0, the move introduces no duplicate old paths, redirect files, fallback readers, or compatibility copies.

The proposed tree is the minimum starting structure, not a fixed taxonomy. Future developer references may add subdirectories when real volume justifies them, while the two audience roots remain invariant.

### Canonical two-minute user entry point

Place a compact **Before you try the early preview** summary in `README.md` and `docs/user/guide/index.html`. The README keeps the install-free command under an explicit **For agents** heading; the human guide explains how a reviewer starts and completes work with an agent without duplicating agent commands. The summary states:

- the Early macOS preview label;
- macOS, architecture, and Node requirements;
- the unnotarized/ad-hoc signing status;
- the local-data and telemetry boundary;
- the early-preview review-format policy;
- links to Markdown limitations, privacy/storage/recovery, cleanup, and support.

The website home page at `docs/user/index.html` labels the product as an Early macOS preview and routes prospective users to this setup summary. It does not duplicate the full disclosure set or link users into developer documentation as a prerequisite.

### Public agent workflow

Add `docs/user/agents/index.html` as the only deployed page addressed directly to agents. It co-locates the ordered `open`, reviewer URL/ID/Terminal handoff, wait, `get`, and `edit` steps; review-ID ownership; the fixed interpretation contract; the snapshotted policy; and completion bounds. It points human reviewers to the user guide and contributors to repository agent guidance.

The human guide retains the user-visible half of the workflow: ask an agent to open a document, review it, say “Check Markover,” and request reopening when feedback changes. It contains no exact agent CLI commands, `review.agentGuidance` fields, or agent policy examples.

### User privacy, storage, and recovery

Expand and retitle `docs/user/privacy/index.html` as the single integrated user data-boundary reference. Preserve #12's verified claims while presenting only the detail a user needs to make decisions or take action:

- what review content and provenance Markover stores;
- the current macOS-account trust boundary and its same-user/administrator limitation;
- when Markover or a recipient may use the network;
- the distinction between persistent application data and the downloaded application cache;
- retention behavior;
- cache-only reinstall, single-review deletion, and complete reset/uninstall procedures;
- backup guidance and the consequences of each operation;
- review-format compatibility and rollback cautions where they affect stored data;
- the tested durability guarantee, failure behavior, and exclusions demonstrated by #39.

The page explains that the API uses an account-confined per-process secret, but it does not require users to understand capability bit length, POSIX mode numbers, discovery-record filenames, route ordering, or diagnostic implementation. A labelled link points interested readers and contributors to `docs/developer/local-service-security.md` in the repository.

The three cleanup levels are deliberately distinct:

1. **Redownload/reinstall:** quit Markover and remove only `~/Library/Caches/Markover/`; review data and settings remain.
2. **Delete one review:** quit Markover, identify the exact review directory under `~/Library/Application Support/Markover/reviews/`, back it up when needed, and remove only that directory.
3. **Complete reset/uninstall:** quit Markover, back up as needed, then remove both the Application Support root and Markover cache; this irreversibly removes all local reviews, attachments, settings, and downloaded app versions.

Shared npm cache cleanup is outside this guide because it is not a Markover-owned data root.

### Developer security and storage reference

Create `docs/developer/local-service-security.md` as the contributor-facing home for the exact #12 mechanics currently mixed into the public privacy page. It covers the capability and discovery-record formats, file modes, route authorization order, health identity, diagnostics/redaction behavior, recovery invariants, same-user threat-model boundary, storage layout, and the source/tests that enforce those claims.

This developer reference links to #39's crash/restart evidence and records the exact persistence and shutdown invariants developers must preserve. The user data page receives only the demonstrated guarantee, actionable failure behavior, and honest exclusions.

### User Markdown support and preview limitations

Add `docs/user/limitations/index.html` and link it directly from the README and the user guide's setup summary. State the current behavior precisely but in task-oriented language:

- Markover structures YAML frontmatter, headings, paragraphs, ordered and unordered lists, task markers, code blocks, thematic breaks, tables, and block quotes.
- Tables and block quotes are selectable as whole blocks; users cannot annotate their internal rows, cells, or quoted children separately.
- Footnotes, definition lists, strikethrough, raw HTML, and other extensions have no specialized structure and may appear as literal or ordinary content.
- Links remain inert. Remote images require an explicit preview action.
- The original Markdown source remains preserved even where Markover cannot represent extension-specific structure.

Parser names, token mapping, review-tree node contracts, and extension implementation strategy belong in developer documentation and existing decision records. The user page may link to those references for contributors, but it does not require that knowledge.

The page also carries concise early-preview product limitations that affect a prospective user's trial. It does not become a copy of the roadmap or an inventory of internal implementation debt.

### Developer entry point and existing guides

Create `docs/developer/README.md` as a concise contributor index. Move `docs/development.md` to `docs/developer/development.md` and `docs/releasing.md` to `docs/developer/releasing.md`, updating repository references and tests atomically.

The developer index routes contributors to setup/testing, architecture and security references, release operations, decisions, roadmap, security policy, and agent-facing repository guidance. It links back to the deployed user contract when a contributor needs to verify the promise their change must preserve.

The release truth from [PR #83](https://github.com/lastobelus/markover/pull/83) is included before `docs/releasing.md` moves to `docs/developer/releasing.md`, so the audience-root change preserves the canonical published-release record.

### Support and release handoff

Make GitHub Discussions the consistent general-support link across the README and user root. Retain the specialized bug-report and private-security routes. Developer documentation may reference those public intake paths while separately documenting maintainer triage and sanitized diagnostic interpretation.

Issue #9 owns the canonical user-facing wording and gives [issue #10](https://github.com/lastobelus/markover/issues/10) an exact release-note checklist. Issue #10 owns the actual tag, prerelease body, artifacts, and publication. Issue #9 does not change #13's stable-release machinery merely to prepare preview copy.

The #10 checklist requires:

- **Early macOS preview** and the intended audience;
- the exact trial command and supported requirements;
- signing/notarization status;
- meaningful user-facing limitations;
- links to user privacy/storage/recovery, Markdown support, and support;
- the tested durability statement once available;
- the rollback target and applicable review-format caveat.

Release implementation mechanics remain in `docs/developer/releasing.md` and do not appear in the user guide merely because release notes link to user documentation.

## Delivery sequence

### Checkpoint 1 — audience roots and evidence-independent documentation

1. Refresh inflight intents and verify the merged release truth before moving `docs/releasing.md`.
2. Start from current `main`, including the merged #12 privacy page and any intervening documentation work.
3. Establish `docs/user/` and `docs/developer/`, move existing files atomically, and update repository links and test fixtures without compatibility copies.
4. Change the Pages artifact root to `build/docs/user` and verify that developer documentation is absent from the deployed artifact while public URLs remain unchanged.
5. Add the developer index and split exact local-service security/storage mechanics out of the user privacy page into the developer reference.
6. Add the canonical maturity label and compact setup disclosure to the README and human user guide.
7. Add the dedicated public agent workflow and remove agent-only commands and policies from the human guide.
8. Label the user website hero as an Early macOS preview and route its primary trial path to the user guide summary.
9. Add the user Markdown support and preview limitations page, user navigation, and primary-path links.
10. Expand the user privacy page with the accepted compatibility, storage, retention, cleanup, reinstall, and support material while leaving untested durability language out.
11. Normalize general-support links in the user root and preserve the existing specialized intake routes.
12. Add semantic documentation tests for root segregation, deployment exclusion, audience separation, the new label, requirements, links, compatibility boundary, cleanup distinctions, and support model.
13. Run the focused documentation tests, `npm run check`, and `npm test`; inspect the deployed user artifact and visually inspect desktop and narrow user layouts.
14. Commit the completed checkpoint and coordinate its landed user privacy page and developer reference with #39 before #39's public-documentation slice edits either surface.

### Evidence gate — issue #39

Before adding public durability language, inspect #39's final tested evidence rather than copying its accepted design contract as though it were already proven. The evidence must identify:

- the tested maximum-loss window and the conditions under which it applies;
- editing, inflight-agent, handoff/reopen, multi-review, and attachment-ordering scenarios actually exercised;
- graceful-quit behavior and the tested failure/force-quit path;
- write-failure warning and retry behavior actually demonstrated;
- packaged-app restart validation actually performed;
- exclusions such as unhealthy storage, power loss, hardware failure, and operating-system failure;
- any gap between the accepted #39 contract and the behavior that ultimately landed.

If #39's evidence changes a claim, the tested result wins. No compatibility layer, migration, or broader durability promise is added to reconcile the difference.

The evidence gate produces two audience-specific outputs: a concise user guarantee with actionable limits, and a developer record of the tested mechanisms, scenarios, invariants, and evidence locations. Repetition between them is intentional.

### Checkpoint 2 — tested durability and final consistency

1. Integrate #39's demonstrated user guarantee and limitations into `docs/user/privacy/`.
2. Record the corresponding mechanisms, invariants, evidence, and maintenance cautions under `docs/developer/`.
3. Add only the shortest useful durability summary to the two-minute user setup disclosure and link to the full user explanation.
4. Give #10 the final user-facing release-note checklist and exact canonical links.
5. Audit the README, user website, user guide, user privacy/storage/recovery page, user limitations page, bug template, support links, and release-facing copy for consistent user claims.
6. Audit developer documentation for current paths, technical accuracy, and explicit links back to the user contract without leaking it into the Pages artifact.
7. Extend semantic tests to protect audience segregation and the tested guarantee with its qualifying conditions without freezing prose wholesale.
8. Repeat desktop and narrow user-site checks, validate repository and deployed links/assets, run `npm run check`, and run `npm test`.
9. Commit the completed checkpoint after the final review findings are addressed.

## Validation strategy

Automated checks should assert audience boundaries and semantic anchors rather than complete paragraphs:

- `docs/user/` and `docs/developer/` both exist and own the expected entry points;
- Pages uploads `build/docs/user`, preserves the existing public URL shape, and excludes developer documentation;
- `/guide/` addresses human reviewers while `/agents/` owns exact agent commands, review-ID handling, and interpretation policy;
- repository links no longer target the former mixed-root paths;
- every public user entry surface uses **Early macOS preview**;
- README and user guide agree on macOS 14 Sonoma, Apple Silicon, native Intel deferral to #80, and Node.js 22.13.0 or newer;
- the user setup path links to both detailed user reference pages and GitHub Discussions;
- the user limitations page distinguishes structurally selectable, whole-block, and extension-degraded Markdown behavior without parser implementation detail;
- user cleanup guidance distinguishes the cache root from persistent Application Support data and distinguishes reinstall from destructive reset;
- user compatibility wording contains no promise of universal backward or forward readability;
- the user privacy page retains the tested #12 account boundary and absence of telemetry/automatic upload without requiring protocol knowledge;
- the developer security reference retains the exact #12 mechanics, threat-model limits, diagnostic rules, and enforcing source/test pointers;
- checkpoint 2 includes #39's tested guarantee and exclusions in user language and the corresponding evidence/invariants in developer language;
- the bug form continues to request minimal sanitized diagnostics.

Manual validation includes:

- reading only the deployed user setup path as a prospective user and confirming the core contract is discoverable in under two minutes without contributor implementation detail;
- following the developer root as a new contributor and confirming setup, tests, release operations, architecture/security detail, and the user contract are discoverable without entering the user guide first;
- checking the user website, human guide, agent workflow, privacy/storage/recovery page, and limitations page at desktop and narrow widths;
- confirming user-to-developer and developer-to-user cross-links are clearly labelled and optional;
- verifying that some repetition improves local clarity and no page delegates essential audience-specific explanation to the other root;
- verifying commands, filesystem targets, protocol details, and evidence pointers against current code immediately before publication.

## Scope boundaries

This issue changes documentation architecture, documentation, deployment selection, links, and documentation-focused validation. It does not add:

- shared prose fragments, transclusion, a documentation framework, or deduplication machinery between the audience roots;
- duplicate legacy paths, redirects, compatibility copies, or a `/user/` prefix in deployed public URLs;
- a third mixed or agent-only documentation root outside `docs/user/` and `docs/developer/`;
- data migrations, fallback review readers, dual writers, or a promise that every version opens every historical review;
- in-app review deletion or cache-management UI;
- new telemetry, network behavior, authorization mechanisms, or threat-model claims;
- autosave, shutdown, attachment-ordering, or crash-recovery behavior owned by #39;
- tags, prerelease publication, release assets, or stable-release workflow behavior owned by #10 and #13;
- unsupported Markdown parsers or new structural node types;
- platform support beyond the accepted early macOS preview requirements.

Repository-convention files such as `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, `DECISIONS.md`, and `ROADMAP.md` remain at the repository root. They act as concise entry points or canonical governance/decision records and link into the appropriate audience root; they do not create a third mixed documentation root.

## Dependencies and overlap controls

- **#12:** merged source of truth for local authorization, privacy boundaries, diagnostics, and remote-image behavior. Preserve its verified claims while separating user consequences from developer mechanics.
- **#39 / PR #82:** merged source of truth for the final durability language. Its tested evidence feeds separate user/developer explanations.
- **#10:** consumes the user-facing release-note checklist and publishes the actual prerelease.
- **#13 / PR #83:** merged source of truth for release provenance, packaged smoke, stable-release tooling, and the runbook content moved under the developer root.
- **#17:** consumes the completed user documentation during the announcement and support round.

Before each implementation checkpoint, refresh these intents and changed paths. PR #76 retains ownership of deep-link feature copy and rebases those small documentation changes onto the audience roots established here.

## Acceptance mapping

| Issue #9 criterion | Plan evidence |
| --- | --- |
| README, site, and next release consistently say early preview | Canonical user label, entry-point changes, and #10 checklist |
| macOS, architecture, and Node requirements are explicit | User public contract and semantic cross-surface tests |
| Review-format compatibility policy is explicit | User setup summary, user data reference, and user limitations reference |
| Downloads, local data, telemetry, and loopback protection are documented | User consequences in `docs/user/`; exact mechanics in `docs/developer/` |
| Storage, retention, safe deletion, and reinstall are documented | Three cleanup levels in the integrated user data reference |
| Limitations and supported Markdown are linked from setup | Dedicated user limitations page linked from README and user guide |
| One support path and useful sanitized diagnostics | Discussions as general user support; specialized bug/security intake retained and developer triage detail separated |
| User and developer material remain understandable | Two roots, Pages exclusion, optional labelled cross-links, and audience-boundary validation |

## Implementation authorization

The interview and revised plan are complete. Implementation remains in `phase: investigating` until the user approves this plan and explicitly authorizes checkpoint 1.
