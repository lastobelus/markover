# Issue 52: Clickable Review Deep Links

## Outcome

`markover open` returns a stable review URL alongside the review ID and status.
Agents present that URL as a normal Markdown link. Clicking it activates the
addressed Markover instance, focuses its existing window, and selects the
requested managed review without changing review content or status.

Canonical links use:

```text
markover://review/<review-id>
```

An explicitly targeted PR development instance uses its temporary scheme:

```text
markover-<PR>://review/<review-id>
```

For example, PR 42 uses `markover-42://review/mko_8f3a2c` and agents label the
link “Open in Markover PR #42.”

## Product contract

- The scheme chooses exactly one instance identity. `markover:` always means
  canonical Markover; `markover-42:` always means the isolated PR 42 instance.
- A running process takes precedence only inside the addressed identity. No
  handler scans other worktrees, services, or installed applications.
- A link selects a review and focuses Markover. It does not change status,
  feedback, source, files, branches, pull requests, or browser content.
- The URL contains only the instance-selecting scheme and review ID. It never
  contains service ports, credentials, paths, checkout metadata, thread IDs,
  query parameters, or fragments.
- Only the exact `/review/<review-id>` route and existing managed-review ID
  grammar are accepted. Extra components and actions are rejected.
- The addressed instance's durable review store is authoritative. A missing
  review is never searched for in another instance.
- Switching uses the existing source-edit guard. A nonempty edit commits and
  autosaves before the switch; an invalid empty edit prevents the switch,
  preserves the current review, shows the existing toast, and returns focus to
  the editor.
- Switching to an already active review only focuses Markover and preserves its
  in-memory selected block, filter, annotation view, collapse state, drafts,
  attachment previews, and scroll context.
- Switching back to an in-memory review restores that review's in-memory UI
  state. A review loaded for the first time uses normal renderer defaults; this
  issue adds no UI-state persistence.
- Warm links are processed in arrival order. During packaged startup, before
  the renderer is ready, the last valid queued link wins.
- There is no compatibility reader, fallback URL grammar, old activation path,
  dual output format, or historical-review migration.

## Instance model and ownership

PR #61 owns the single instance resolver and remains the source of truth for
identity, state roots, checkout provenance, service endpoint and credential
paths, singleton-lock namespace, branding, process status, cold-start
eligibility, and CLI target resolution.

| Address | Identity and state | URL behavior |
| --- | --- | --- |
| `markover:` | Canonical identity; existing `~/Library/Application Support/Markover` data; one explicit main/blessed checkout descriptor | Unqualified CLI output and packaged releases |
| `markover-<PR>:` | `pr-<PR>` identity; exact owning worktree; ignored `.markover/instance` state | Explicit `--instance dev` CLI output and temporary development bridge |

Canonical development and a released package are alternate implementations of
the same canonical identity and data. They are not run concurrently. PR state
is intentionally worktree-local: removing the worktree is accepted as
destructive cleanup of that PR's reviews, settings, endpoint, credentials, and
lock state.

Issue #52 consumes #61's resolved instance and owns URL construction and
parsing, authenticated activation delivery, renderer selection, packaged
protocol handling, and explicit development-handler install, status, repair,
replacement, and removal.

The instance resolver and URL contract meet at these fields:

- instance kind and key;
- scheme;
- state and service roots;
- endpoint and credential paths;
- exact checkout for management diagnostics;
- process status; and
- PR number and live-state eligibility for install or repair.

There is no second PR-to-worktree registry in #52.

## End-to-end flows

### Agent creates a review

1. The CLI resolves its instance through #61. Unqualified commands resolve
   canonical; `--instance dev` resolves only the current PR worktree.
2. `open` creates the review through the addressed authenticated service.
3. The service continues returning its validated `{reviewId,status}` payload.
4. The CLI constructs `reviewUrl` from the resolved scheme and validated
   response ID, then writes exactly one JSON value to stdout.
5. The agent emits the link and raw review ID, for example:

   ```markdown
   Review ready: [Open in Markover](markover://review/mko_8f3a2c) (`mko_8f3a2c`)
   ```

`get` remains an exact review-artifact handoff and `edit` remains a status
transition. Neither command gains or persists `reviewUrl`.

### Packaged canonical link

1. The packaged application declares only `markover:` in `CFBundleURLTypes`.
2. macOS launches the package when it is stopped or delivers `open-url` to its
   running process.
3. The main process validates or queues the URL, loads the review from the
   canonical store, requests renderer activation, and waits for an explicit
   renderer acknowledgement.
4. The renderer activates the existing session or adds the loaded durable
   review without overwriting a newer in-memory session.
5. The window restores, shows, and focuses. Success is otherwise silent.

The package attempts normal canonical registration on its first ordinary
launch when needed and records that attempt; it does not reclaim the scheme on
every launch. Maintainer QA can explicitly suppress registration so packaging
tests do not steal `markover:` from the canonical development bridge. Handler
status and explicit repair recover ownership drift.

### Development link

1. macOS launches the small registered development bridge for the exact
   canonical or `pr-N` scheme.
2. The bridge validates the URL and reads only its immutable local binding:
   expected scheme, instance identity, and service descriptor path.
3. It reads the addressed endpoint and per-start credential locally, then
   submits the activation request to that authenticated loopback service.
4. The running Markover process performs the same store lookup, renderer
   acknowledgement, selection, and focus flow as the packaged app.
5. The bridge exits. It is on-demand only: no daemon, login item, menu bar,
   Dock icon, or Launchpad entry.

Development bridges never build or launch Markover. If the exact instance is
not running, the bridge shows one native informational modal and exits. The
developer returns to the thread that owns the checkout to build, start, or fix
it, then clicks the link again.

## Activation boundary

Add one authenticated activation operation to the existing loopback service.
It accepts a validated review ID and delegates to a main-process coordinator;
it does not expose a browser route, CORS permission, unauthenticated exception,
or review mutation.

The coordinator must distinguish these outcomes:

| Outcome | Markover behavior | Development bridge behavior |
| --- | --- | --- |
| Activated or already active | Focus window; preserve or restore session UI state | Exit silently |
| Blocked by invalid source edit | Preserve review; existing toast and editor focus | Exit silently after acknowledged delivery |
| Review missing from addressed store | Focus window; preserve selection; nonmodal toast | Exit silently after acknowledged delivery |
| Renderer not ready yet | Queue until renderer can acknowledge | Wait for the bounded service response |
| Renderer acknowledgement timeout | Preserve durable state; report distinct internal error | Native repair/error modal plus bounded diagnostics |
| Incompatible service | No fallback activation path | Modal directing the developer to rebuild/restart |
| Missing, stale, or unauthenticated service | Do not contact another instance | “Markover … isn’t running” or repair modal |
| Malformed or unsupported URL | No instance contact and no navigation | “Invalid Markover link” modal |

Use a typed main/preload/renderer request-response channel, analogous to the
existing snapshot and status acknowledgement paths. The request includes a
request ID and the durable managed document when the renderer does not already
own the session. The renderer result distinguishes activated, blocked, missing,
and internal error. The main process applies a bounded timeout and never treats
mere event emission as successful selection.

When a durable review exists but has not restored into the renderer yet, the
coordinator waits or supplies that stored document and activates it after the
renderer acknowledges readiness. Only absence from the durable store produces
the missing-review outcome.

## Development bridge and handler tooling

Commit the bridge source, generator, tests, and documentation. Generate the
installed apps per user under:

```text
~/Library/Application Support/Markover/Development/Link Handlers/
```

Generated apps are local artifacts, not repository files or release payloads.
Use a tiny native Swift/AppKit executable compiled with the installed Xcode
toolchain. It can receive the custom URL, validate it, read the bound local
descriptor, make the authenticated loopback request, display `NSAlert` errors,
and call LaunchServices for handler inspection and registration without
shipping Electron or Node inside every bridge.

Each generated app has:

- a unique bundle identifier and one declared scheme;
- an identity-specific display name such as “Markover Development Link
  Handler” or “Markover PR 42 Link Handler”;
- `LSUIElement` background-accessory behavior;
- an immutable non-secret binding to the exact instance descriptor; and
- no checkout mutation, dependency installation, Git operation, or Markover
  startup code.

Handler management is explicit developer tooling, separate from agent-facing
`markover open/get/edit`:

- `install`: generate/register the bridge and claim its scheme;
- `status`: report absent, exact, conflicting, stale, incompatible, or healthy
  ownership and identify the bound instance;
- `repair`: rebuild/reregister the expected bridge after validating the
  instance;
- `replace`: explicitly replace a different binding after showing its current
  owner; and
- `remove`: unregister and delete only the expected generated bridge, with an
  explicit force path for a conflicting binding.

Installing the same binding is idempotent. A different binding is never
silently replaced. The same conflict rules apply to canonical `markover:` and
PR schemes. Removing a bridge does not restore a historical owner stack and
does not delete review state. Switching owners is an explicit replacement.

PR handlers require a real open GitHub PR and use the concise globally local
`markover-<PR>:` scheme. Install and repair consume #61's live PR validation.
Link delivery itself is completely offline, so an already-running closed-PR
instance remains addressable until it exits. A closed PR cannot install or
repair a handler.

If a worktree is deleted first, the remaining handler is stale. `status` must
identify it as stale and `remove markover-<PR>` must still work without the
worktree or instance descriptor. No watcher automatically unregisters it.

Routine `npm start` may warn about a missing or unhealthy handler but never
changes LaunchServices ownership.

## PR data cleanup coordination

PR #61 owns a documented optional cleanup command because it owns
`.markover/instance`. The command provides a recoverable alternative to simply
removing the worktree:

1. Resolve one exact `pr-N` worktree root.
2. Refuse the canonical root and any path outside the resolved instance.
3. Refuse while that PR instance is running.
4. Require its #52 handler to have been removed.
5. Move `.markover/instance` to a collision-safe location in macOS Trash.
6. Report the recovery path.

There is no automatic cleanup trigger. Direct worktree removal remains an
accepted destructive cleanup and may leave a removable stale handler.

## Failure presentation and diagnostics

Successful development forwarding is silent. Expected absence uses one simple
modal with one **OK** button, for example:

> **Markover PR #42 isn’t running**
>
> Start the matching development instance, then open this link again.

The bridge offers no build, launch, checkout, retry-loop, or repair controls.
Malformed links get an “Invalid Markover link” modal. Incompatible builds and
handler failures get a concise rebuild/repair message. Bounded local diagnostics
record the scheme, instance identity, error category, and timestamp, but never
the capability token, authorization header, source content, review content, or
query data.

## Implementation slices

### Slice 1 — core URL and packaged behavior

Start after #43 restores the renderer and managed-review selection contract.
This slice does not wait for all of #61.

1. Add one shared TypeScript URL module with construction, strict parsing, and
   existing review-ID validation.
2. Extend CLI `open` to add `reviewUrl` from the selected instance scheme while
   preserving one-JSON stdout and unchanged service creation payloads.
3. Add the authenticated activation service route and main-process coordinator.
4. Add typed preload/renderer activation request and acknowledgement behavior,
   including source-edit blocking, missing-review toast, startup readiness, and
   in-memory session preservation.
5. Add packaged `CFBundleURLTypes`, early `open-url` capture, startup last-valid
   queuing, explicit first-launch registration, and QA suppression.
6. Update package preflight checks, CLI help, `AGENTS.md`, focused-preview docs,
   and agent examples so clickable links are the standard handoff.
7. Add focused unit/integration tests and manually validate a packaged canonical
   link while stopped and running.

Slice 1 can use canonical `markover:` while keeping URL construction parameterized
by a resolved scheme, so Slice 2 does not require a compatibility rewrite.

### Slice 2 — development bridge and instance integration

Start after #61's resolver, startup, and explicit CLI target contract are
stable and rebased over #43.

1. Consume #61's `ResolvedInstance` contract for canonical and current-worktree
   PR targeting; do not duplicate path or identity rules.
2. Add the native bridge source and deterministic per-binding app generator.
3. Add explicit install, status, repair, replace, and remove tooling with
   exact-binding conflict protection and stale-handler removal.
4. Implement forwarding-only authenticated delivery, native modal errors,
   bounded redacted diagnostics, and fully offline clicks.
5. Coordinate #61's optional Trash cleanup script and lifecycle documentation.
6. Validate canonical and simultaneous PR routing, closed/stale behavior, and
   ownership changes.
7. Complete the required host matrix and documentation before closing #52.

Issue #52 closes only after both slices meet their gates.

## Verification matrix

Automated coverage must protect:

- canonical and PR URL construction, plus rejection of malformed schemes,
  routes, IDs, authority components, queries, fragments, and extra paths;
- `open` returning `{reviewId,status,reviewUrl}` while `get` and `edit` remain
  unchanged and stdout remains exactly one JSON value;
- authenticated-only activation and unchanged denial/redaction behavior from
  #12;
- exact addressed-store lookup with no cross-instance fallback;
- renderer acknowledgement, readiness queueing, timeout classification,
  missing-review toast, same-review no-op, source-edit guard, and in-memory UI
  preservation;
- packaged plist/preflight metadata, early `open-url`, warm delivery, cold
  launch, and no duplicate instance;
- deterministic native bridge generation, strict binding, redacted failures,
  idempotent install, explicit conflicts, repair, removal, and stale removal;
- canonical-versus-PR and PR-versus-PR isolation, including separate endpoints,
  credentials, locks, reviews, settings, and selection; and
- handler removal preserving state, direct worktree removal leaving a stale
  removable handler, and optional cleanup moving only the exact PR root to
  Trash.

Manual validation must include:

| Surface | Required evidence |
| --- | --- |
| T3 Code | A real Markdown link click opens the addressed instance and review |
| Codex | A real Markdown link click opens the addressed instance and review |
| Terminal.app | Test Command-click; document `open '<url>'` fallback if the terminal does not linkify the scheme |
| iTerm2, when installed | Same Command-click and fallback validation |
| Packaged clean machine | Canonical stopped/running, active/different/missing review, first registration, and normal cold launch |
| Maintainer machine | Canonical development bridge keeps ownership during suppressed package QA |
| Two live instances | Canonical link reaches only canonical; `markover-N:` reaches only PR N |
| Missing target | Canonical stopped while PR runs, and PR stopped while canonical runs, both show the exact unavailable modal with no fallback |
| Rapid/startup links | Warm arrival order and packaged-startup last-valid behavior |

Successful end-to-end clicking from both T3 Code and Codex is a hard closure
criterion. Terminal.app and iTerm2 are best-effort linkification surfaces with
the explicit `open '<url>'` fallback; OSC 8 and terminal-specific stdout formats
are out of scope.

## Dependencies and roadmap position

- #43 is the gate for Slice 1 and for #61's remaining startup integration.
- PR #61 is the gate for Slice 2's PR-scoped handler integration.
- #12 remains independent; #52 adds one authenticated operation without
  weakening or duplicating its authorization boundary.
- #7, #13, and #39 remain independent inflight work.
- #52 lands before #10 and #11 produce and validate the focused-preview
  prerelease, and its public example is complete before #16 closes.
- #59 owns future “Copy review link” context-menu UI on document tabs and
  document-list nodes. No copy-link UI is included here.

Roadmap status is **In progress — planning complete** with **High** priority,
**Focused preview** milestone, **Independent** delivery, and **Product contract**
workstream. Implementation is deliberately split so core work can begin as
soon as #43 lands while the development-handler slice integrates after #61.

## Explicit non-goals

This issue does not add block, annotation, file, branch, pull-request, callback,
web, or remote deep links; arbitrary file opening; browser navigation; copy-link
context menus; OS support beyond macOS; terminal OSC 8 formatting; automatic
development builds; automatic checkout or dependency mutation; a bridge daemon;
automatic handler ownership changes from routine development launch; automatic
PR data cleanup; cross-instance review search; or compatibility machinery for
pre-feature builds.

## Implementation handoff

After this plan is approved in Markover:

1. Wait for #43, then rebase the #52 implementation branch onto its merged
   renderer/build contract.
2. Implement and verify Slice 1 as one cohesive PR or reviewable PR slice.
3. Rebase inflight branches that need the new renderer/instance system rather
   than maintaining compatibility paths.
4. Wait for #61's resolver and startup contract, then integrate Slice 2 without
   creating another registry or identity model.
5. Run focused tests, `npm run check`, the full test suite, package preflight,
   and the manual host/instance matrix.
6. Preserve each completed, accepted slice in a natural checkpoint commit.
7. Close #52 only after the T3 Code and Codex clicks work end-to-end and the
   packaged and development ownership flows are both verified.

No implementation, application restart, branch movement, or release action is
authorized by this planning document.
