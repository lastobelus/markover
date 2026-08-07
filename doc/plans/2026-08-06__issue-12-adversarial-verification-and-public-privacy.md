# Issue 12: Adversarial Verification and Public Privacy

Intent: confirmed 2026-08-06

Status: approved without notes on 2026-08-06; implemented and locally verified;
draft PR #67 open.

## Outcome

The third and final issue-12 pull request turns Markover's implemented local
authorization boundary into an auditable product claim. It verifies the real
loopback server against hostile credentials across every route that currently
exists, fixes one bounded Bearer-syntax standards defect, gives users control
over local Codex session discovery, publishes an accurate public privacy and
local-data explanation, and updates the canonical authorization ELI5.

When the pull request merges, issue 12 closes. Deletion UI, durability,
packaged-artifact smoke, broader preview documentation, and an in-app Help link
remain with their existing roadmap owners.

## Milestone complexity guardrail

Implementation favors the smallest good-enough system that satisfies the
Focused preview milestone. It does not attempt to anticipate every edge case
for a user base that does not yet exist.

If the work begins to require cross-layer machinery, generalized abstractions,
new compatibility behavior, or a wider threat model merely to satisfy a rare
or hypothetical case, implementation stops and the design discussion reopens.
The preferred resolution is a simpler milestone path with the added complexity
deferred until real users and deployment evidence justify it.

## Starting point

Merged PR #41 established the protocol-2 capability boundary. Merged PR #56
added health identity consistency checks, bounded record convergence, in-place
record repair, deterministic recovery, and no replay after ambiguous
transmission. The reusable development smoke has already completed its live
restart run.

The unpublished `agent/launch-api-security-verification` branch contains no
unique work and is behind `origin/main`. After this plan is approved, it is
realigned directly to current `origin/main`; no merge scaffold, compatibility
layer, migration, dual reader, or historical-data rewrite is retained.

Issue 12's GitHub description still calls PR #56 a draft. The final handoff
updates the three-PR stack and acceptance checklist before closing the issue.

## Product and threat boundary

The supported security boundary remains the macOS user account:

- Markover listens on plain HTTP at `127.0.0.1`.
- A caller that can reach loopback but cannot read the protected per-process
  capability cannot read or mutate reviews.
- The application-data directory is mode `0700`; `service.json` and
  `service.token` are mode `0600` on POSIX systems.
- Processes running as the same user, administrators, and root remain inside
  the trust boundary.
- Fast User Switching runs independent Markover instances with separate
  per-user data, endpoints, and credentials.
- Windows is not a supported product target and receives no ACL implementation
  or security claim in this pull request.

Exact `GET /health` remains the only public request. It returns `status`,
protocol version 2, and the non-secret per-process instance ID. The instance ID
is a consistency name tag used to avoid sending a capability to an ordinary
unrelated listener; it is not a credential or cryptographic proof against a
prepared same-user impersonator.

## Current protected route inventory

The verification suite names only real routes:

- `GET /reviews`
- `POST /reviews/import`
- `POST /reviews`
- `GET /reviews/:id`
- `POST /reviews/:id/handoff`
- `POST /reviews/:id/edit`
- unknown routes, which must authenticate before returning `404`

There are no separate attachment or deletion HTTP routes. Attachments are part
of review artifacts, and deletion is future issue-15 work. This pull request
does not invent placeholder routes or a production route registry solely for
testing. When a later pull request adds a protected route, its own tests must
extend the named inventory.

## Bearer syntax correction

The service currently accepts only the exact spelling and single space in
`Authorization: Bearer <token>`. HTTP authentication scheme names are
case-insensitive, and Bearer syntax permits one or more spaces before the
credential.

The server therefore accepts:

- one and only one `Authorization` field value;
- case-insensitive `Bearer`;
- one or more ASCII spaces after the scheme; and
- exactly one Markover capability in its existing 43-character base64url
  shape.

It continues to reject tabs, missing credentials, invalid token characters or
lengths, appended text, unsupported schemes, and duplicate field values. Node's
HTTP parser removes outer field-value whitespace before Markover receives the
header, so that standards-based normalization is accepted rather than
reimplemented below the server layer. Every rejected form receives the same
external `401` response. The shared client continues to emit the canonical
capitalized, single-space form.

This is a small standards correction inside the existing boundary, not a new
client compatibility mode.

## Layered adversarial HTTP verification

The suite sends raw requests over real HTTP to `startLocalService` bound to
loopback. Every adversarial fixture uses a temporary review store, temporary
records, and temporary credentials; hostile probes never target the user's
running Markover instance or historical reviews.

The matrix is layered rather than a wasteful full Cartesian product:

1. Exercise every credential failure class against a representative sensitive
   mutation.
2. Exercise every protected route with a missing credential and a
   validly-shaped incorrect credential.
3. Prove the generic `401` occurs before route-specific parsing, JSON body
   parsing, store calls, callbacks, or state mutation.
4. Prove valid credentials reach each real route and that each route retains
   its normal application response.
5. Prove unknown routes are gated before `404`.
6. Prove only exact `GET /health` is public; query variants and other methods
   are protected.

Failure cases include absent, unsupported-scheme, empty, malformed-shape,
wrong-length, wrong-character, valid-shape mismatch, tabs or appended text, and
duplicate credentials. Accepted case and spacing variants receive focused
positive coverage. Tests assert the identical structured `401`, Bearer
challenge, sanitized diagnostic category, and unchanged temporary store.

The suite also locks down the existing `0700`/`0600` POSIX contract and the
strict redaction boundary. Capability values, complete authorization fields,
query strings, and request or review bodies may not appear in authentication
responses or diagnostics. Method, query-free pathname, coarse rejection
reason, protocol version, and instance ID remain permitted. Purpose-required
values in an explicitly requested successful review result are not globally
suppressed.

## Bounded verification scope

This is authorization verification, not generalized network resilience work.
It excludes random fuzzing, sustained load, slow-client attacks, enormous
authenticated bodies, and denial-of-service attempts from processes already
trusted as the same OS user. The existing request-size limit remains in force.
A concrete unrelated defect discovered by the focused probes is filed
separately unless it can be fixed narrowly without changing the agreed threat
model or architecture.

A true two-account Fast User Switching smoke is also excluded. Deterministic
path and permission checks verify the Markover-specific assumptions; macOS
owns cross-account isolation.

## Local session-discovery control

Markover currently uses an exact high-entropy handoff key to search a bounded
set of recent local Codex session-log tails when no explicit thread ID is
available. It retains only selected thread provenance from an unambiguous
match, not copies of the scanned logs.

Settings gains a default-on, persisted, per-user Privacy switch:

> **Discover agent thread from local session logs**
> When no explicit thread ID is provided, search recent local Codex session
> records for the review's handoff key. Nothing is uploaded.

The switch appears in a new Privacy section immediately before Diagnostics.
It applies on the next `open` without an application restart.

The CLI reads the shared per-user settings file through the existing settings
normalization boundary before attempting handoff-key discovery. It remains a
read-only settings consumer; no API route is added for this preference.

Behavior is explicit:

- A missing settings file uses the documented enabled default.
- A valid settings file obeys the stored value.
- An existing but malformed or unreadable settings file fails closed by
  skipping local-session inspection.
- Disabled discovery silently ignores the handoff key, stores no inferred
  `agentThread`, and preserves the normal machine-readable `open` result.
- An explicit `--thread-id` remains authoritative and requires no log scan.
- Read-only Git and explicit pull-request provenance remain unchanged.
- The handoff key itself is not retained in the review artifact.

Focused settings, CLI, and metadata-discovery tests cover defaults,
normalization, persistence, immediate use, malformed/unreadable fallback,
silent opt-out, explicit-thread behavior, and unchanged Git discovery.

## Public privacy and local-data page

PR 3 publishes a dedicated plain-language public page, linked from the README,
user guide, and public-site navigation. `SECURITY.md` remains focused on
vulnerability reporting. The new page distinguishes data that stays local
from data that is automatically safe to share.

The page accurately explains:

- **Stored review data.** Full source content, structured review state,
  annotations, source-edit proposals, attachments, and review timestamps.
- **Stored provenance.** Source and repository paths, sanitized repository
  remote, branch, commit, pull-request number, and explicit or discovered agent
  thread metadata such as IDs, working directories, parent/fork provenance,
  and selected log path.
- **Local inspection.** Read-only Git commands and the bounded Codex session
  search, including the default-on user control for the latter.
- **Storage locations.** The root
  `~/Library/Application Support/Markover/`, per-review `review.json` and
  attachments, settings, and temporary service discovery/credential records.
- **Retention and deletion.** Reviews and attachments persist until manually
  removed. Until issue #15 supplies in-app deletion, users quit Markover before
  deleting the relevant review directory so live state cannot be persisted
  again. Issue #9 owns the fuller cleanup and reinstall guide.
- **Original files.** Source-edit proposals live inside the review artifact;
  Markover does not apply them to the original Markdown source.
- **Authorization.** The macOS account boundary, POSIX modes, capability,
  public health name tag, same-user and administrator limitations, and
  independent Fast User Switching instances.
- **Agent handoff.** An authenticated agent may retrieve review content and
  metadata. Once received, that agent's storage, logging, and network behavior
  is outside Markover's control.
- **Network behavior.** Ordinary review handling has no telemetry, analytics,
  cloud sync, or automatic review upload. Installation or update can contact
  npm and GitHub. Explicitly opening an HTTP(S) Markdown image contacts its
  host and reveals ordinary request metadata such as the user's IP address.
- **Sharing caution.** Review artifacts and otherwise legitimate command
  output can contain sensitive content, local paths, repository details, and
  agent identifiers; users inspect or sanitize them before sharing.

The page avoids the absolute claim that Markover never connects to the
internet and avoids implying that OS-account-local means inaccessible to every
process on the machine.

Issue #64 owns the future native Help-menu link to this page, is blocked by
issue #9, and coordinates safe external navigation with issue #6. PR 3 does
not add an interim application-menu implementation.

## Remote-image evidence

Markdown image syntax initially renders as a source-labelled button rather
than an `<img>` with a network-capable source. Only an explicit preview action
assigns the resolved HTTP(S) URL to the preview image.

A deterministic renderer test proves the initial inert DOM and the explicit
transition. It does not contact a real external host. The product behavior is
unchanged: no prompt or separate remote-image setting is added.

## Documentation and explanation

`DECISIONS.md` is updated with the final verification and privacy decisions,
including standards-valid Bearer parsing, the session-discovery switch, public
claims, and the completed three-PR stack.

The existing self-contained
`doc/explanations/2026-08-03__local-api-authorization-eli5.html` is updated in
place. Git preserves its history; no second compatibility-era explanation is
created. It becomes the canonical ELI5 for the complete current system:

- service identity and protected record publication;
- public health preflight and bounded recovery;
- per-request authorization and the real route matrix;
- diagnostics and redaction;
- macOS account and Fast User Switching boundaries;
- stored data, agent handoff, local discovery, and its setting;
- remote-image and installation network exceptions; and
- explicit non-goals and separately owned roadmap work.

Immediately before editing the ELI5, the implementation thread reads and
follows the complete repository `eli5-html-doc` skill. The finished artifact
receives all prescribed static, link, and browser-path verification.

Documentation tests validate durable semantic anchors rather than snapshotting
whole paragraphs: page existence, navigation, storage and network categories,
retention/deletion guidance, session-discovery control, and links to the
behavioral evidence remain stable while prose stays editable.

## Ownership boundaries

- **Issue #12 / this PR:** adversarial protocol-2 verification, the bounded
  Bearer correction, local-session-discovery privacy control, technically
  verified public privacy/data claims, and the completed authorization ELI5.
- **Issue #39:** bounded-loss autosave durability across crashes and restarts.
- **Issue #13:** reuse of the happy-path protocol/restart smoke against final
  packaged artifacts and clean Intel hardware, without duplicating hostile
  authorization or durability tests.
- **Issue #9:** broader preview positioning, requirements, compatibility,
  install/reinstall, cleanup, limitations, support, and documentation
  consistency.
- **Issue #15:** usable review/attachment deletion and orphan cleanup.
- **Issue #64:** native Help menu and in-app link to the public privacy page.

The shared smoke fixture remains reusable evidence. PR 3 does not run another
user-coordinated live restart unless its implementation materially changes the
fixture or runtime integration.

## Explicit non-goals

This pull request does not add:

- Same-user, administrator, or root-process isolation.
- Cryptographic server authentication, local TLS, Unix sockets, CORS, or
  browser-client support.
- Windows ACLs or Windows product support.
- Load, slow-client, random-fuzz, or trusted-user denial-of-service testing.
- Attachment or deletion HTTP routes, review deletion UI, or compatibility
  placeholders for either.
- Crash/restart durability changes or requirements to drain inflight reviews.
- A second live development restart smoke or packaged-artifact execution.
- Telemetry, analytics, cloud sync, or a remote-image prompt/setting.
- A native About or Help menu; issues #63 and #64 own those surfaces.
- Protocol fallback, dual readers/writers, migrations, or historical-review
  rewrites.
- A separate permanent security report beyond the plan, tests, public page,
  decision record, ELI5, and compact PR evidence map.

## Implementation sequence

After this plan receives a no-note or addressed-note Markover approval:

1. Realign the unpublished `agent/launch-api-security-verification` branch
   directly to current `origin/main`, switch this worktree to it, and reread
   repository guidance.
2. Add the layered real-HTTP route and credential matrix, POSIX permission and
   redaction assertions, and standards-valid Bearer cases.
3. Make the bounded Bearer parser correction without changing canonical client
   output.
4. Add the persisted session-discovery setting, Privacy UI section, shared
   read-only CLI lookup, fail-closed corrupt-settings behavior, and focused
   tests.
5. Add the inert-remote-image renderer assertion.
6. Publish and link the public privacy/local-data page, then add semantic
   documentation checks.
7. Update `DECISIONS.md`, issue-12 stack language, and the canonical ELI5 using
   the prescribed skill and verification path.
8. Run focused tests while iterating, then `npm run check` and the complete
   `npm test` suite. Run the automated smoke fixture through the suite; do not
   mutate the user's live records or restart Markover without a newly
   discovered need and explicit approval.
9. Commit the verified runtime/test slice at a natural checkpoint, then commit
   the public documentation, decision record, and ELI5 checkpoint.
10. Push only the real verification branch and open a draft PR against `main`
    with `Closes #12`.
11. In the PR description, include a compact claim-to-evidence map and explicit
    non-goals. Update issue #12's acceptance checklist and merged PR-stack
    wording.
12. Babysit CI and Codex review using the repository's polling guidance,
    address actionable findings, rerun proportional verification, and mark the
    PR ready only when the evidence and public claims agree with the code.

## Acceptance evidence

The final handoff must show:

- Every current protected route denies missing and valid-shape incorrect
  credentials before application behavior.
- The representative mutation denies every named malformed credential class
  with one indistinguishable external response and no body parsing or state
  change.
- Standards-valid Bearer capitalization and spacing succeed; ambiguous forms
  fail; Markover's client remains canonical.
- Unknown routes authenticate before `404`, and only exact `GET /health` is
  public.
- POSIX permissions and diagnostic redaction remain enforced.
- The default-on discovery control persists, applies without restart, silently
  disables only handoff-key scanning, and fails closed for corrupt or
  unreadable existing settings.
- Explicit thread IDs and Git provenance still work when scanning is disabled.
- Remote images remain inert before explicit preview.
- The privacy page, README, guide, navigation, decision record, and canonical
  ELI5 agree with executable behavior.
- `npm run check`, the complete test suite, and prescribed ELI5/browser checks
  pass.
- The PR evidence map names the macOS account boundary and all explicit
  non-goals without claiming deletion, durability, packaged smoke, or
  same-user protection.

## Delivery structure

The expected pull request has two natural checkpoints:

1. Adversarial verification, bounded Bearer correction, session-discovery
   control, and behavioral tests.
2. Public privacy page and navigation, formal decisions, final canonical ELI5,
   and documentation verification.

Small review-driven fixes may receive their own focused commit. The branch
opens as a draft. Issue #12 closes only after tests, documentation, CI, and
review all confirm the same boundary.
