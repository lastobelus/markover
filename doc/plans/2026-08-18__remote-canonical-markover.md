# Remote agents posting to canonical Markover

Status: implementation-ready. This document is the first commit in Slice A’s
implementation PR; product changes follow in that PR.

Implementation tracking: before product changes land, create one issue that
owns the four-PR stack. The current PR owns Slice A; Slices B–D are stacked
children with the bases recorded below.

## Outcome

Build one opt-in **remote-client → remote-canonical seam**:

```text
Remote client host Markover CLI
  → HTTPS to the canonical host’s exact *.ts.net name
  → Tailscale Serve (tailnet-only; never Funnel)
  → fixed loopback-only gateway in canonical Markover
  → exact Tailscale capability plus scoped challenge-response proof
  → existing authenticated local-service mutation core
  → existing queues, ReviewStore, SettingsStore, renderer, and UI
```

The canonical host remains the only Markover app, settings writer, review store,
attachment store, renderer, and lifecycle authority. The remote client host runs the architecture-neutral
CLI and Tailscale only. It never launches Markover, creates a review store, or
receives the canonical host’s local bearer token.

This is a narrow feature, not configuration-only support. The first delivery is
a two-host pilot. General-user promotion follows only after the installed
Tailscale variants, setup doctor, revocation, and privacy disclosures are
proven. Unsupported transport fails closed; it never falls back to Funnel,
direct Tailscale-IP binding, a second store, or an uncredentialed loopback gateway.

## Product decisions

1. **Remote source state is `unavailable`.** Reviews created through the remote
   gateway use `origin: remote-agent`. The canonical host returns existing unavailable source
   and project states before filesystem or Git access. A new renderer/IPC state
   has no pilot behavior to justify it.
2. **Creation receipts are portable digest records.** An optional
   `review.creationReceipt` contains a version, the digest of a high-entropy
   idempotency key, and the digest of the exact initial request bytes. The raw
   key lives only in the remote client host’s restricted journal and authenticated requests.
3. **Uncertain `open` retries recover by key before rebuilding a body.** The
   client first performs a body-free recovery mode on remote `POST /reviews`
   using its journaled key and original request digest. This avoids both
   storing review contents locally and inventing a lossy canonical subset of
   creation fields. The journal keeps a digest **history** per key, so a
   conflict against the client’s own superseded attempt self-recovers (see
   protocol below).
4. **Recovery does not replay `created`.** A key match returns the original
   review ID, status, and canonical URL without sending another incoming-review
   notification. The store and exact deep link are the recovery sources of
   truth; a canonical-host relaunch republishes persisted reviews. This is grounded in
   code: the `created` path resolves project context, enqueues an
   incoming-review notification, reinstalls the menu, and creates the main
   window if absent ([main.ts](../../src/main.ts#L1343)) — replay is not a
   neutral upsert.
5. **Ingress derives origin.** Ordinary local create remains `agent`; the
   remote gateway pins `remote-agent` and rejects any remote body claim. The
   internal producer contract accepts only those two currently supported write
   values, while portable readers continue accepting unknown nonblank origins.
6. **The canonical host governs optional session discovery.** Authenticated remote health
   carries a snapshot of its canonical
   `discoverAgentThreadFromLocalSessions` setting. That snapshot governs
   local discovery on the remote client host for the command; explicit thread identity remains
   authoritative. No remote-client settings writer or settings route is added.
7. **The gateway setting is canonical and live.** Enable loads or creates one
   owner-only, scoped gateway credential and binds only fixed
   `127.0.0.1:39831`. Disable stops new requests, drains the bounded active
   request, and closes the gateway. Development and smoke instances cannot
   activate it.

## Tailscale evidence and boundary

Verified live during this investigation: the canonical host runs Tailscale 1.102.2 as the
signed Standalone system-extension variant (`codesign` identifier
`io.tailscale.ipn.macsys`; its network extension is the running process). The
installed CLI explicitly documents:

```text
On Unix-like systems, you can also specify a Unix domain socket
(e.g., unix:/tmp/myservice.sock).

Expose a service listening on a Unix socket (Linux/macOS/BSD only):
tailscale serve unix:/var/run/myservice.sock
```

It also advertises `--accept-app-caps`. The live pilot proved that the
Standalone macOS network extension accepts a Unix target but cannot connect to
a socket beneath the user's Application Support tree: its proxy log reports
`operation not permitted`, and its App Sandbox entitlements do not grant that
tree. Direct owner access to the same healthy Markover socket succeeds. The
pilot therefore uses Tailscale's documented loopback HTTP reverse proxy while
keeping the exact capability gate and adding challenge-response authentication
from a separate scoped credential to preserve the other-account boundary.

Use Tailscale Serve, never Funnel:

- Pin the canonical host’s exact HTTPS `*.ts.net` base URL and expected Markover protocol,
  `role: canonical`, and `scheme: markover`.
- Require normal certificate and hostname validation. Reject HTTP, IP URLs,
  redirects, protocol mismatch, and non-canonical role before private bytes.
- Forward one application capability, for example
  `lastobelus.com/cap/markover-remote-client`; forwarding requires Tailscale
  1.92 or newer
  ([Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers)).
- Bind one dedicated HTTPS port and the capability to the exact remote-client
  host selector and exact canonical host destination. Do not replace or
  modify another handler already at the root HTTPS endpoint. Prefer a readable host alias over a raw Tailscale IP. A
  user-wide selector is too broad because the canonical host and the remote client host share one user
  identity ([grant selectors](https://tailscale.com/docs/reference/syntax/grants)).
- Accept the Serve capability and a fresh request proof from the dedicated
  gateway credential before route selection or body parsing. Neither the
  gateway credential nor `service.token` crosses the network.

Serve strips client-supplied identity/capability headers before forwarding its
own. Loopback is reachable by another local account, so the capability header
alone is insufficient: that account could forge it. Canonical Markover stores
a stable gateway credential in owner-only `remote-gateway.token`, and the
remote client reads the same credential from an owner-only profile. Health
proves server possession before the client sends a nonce-, method-, path-, and
body-bound proof; the gateway consumes the nonce once and authenticates its
JSON response. Another ordinary account can reach HTTP but cannot authenticate,
and a process occupying the fixed port cannot forge health or harvest the
shared credential. A process running as
the same account, an administrator, or root remains inside Markover’s
documented local trust boundary and is not claimed to be isolated.

Any Tailscale login or HTTPS-consent URL is printed for manual Safari use.
Markover does not drive OAuth or edit tailnet policy. HTTPS certificate
issuance publishes the canonical host’s certificate name to Certificate Transparency, so the
machine name must contain no sensitive information
([HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates)).

## Recorded decisions and documentation

The first implementation stack must deliberately amend existing records:

- [`DECISIONS.md`](../../DECISIONS.md) retains local protocol 2 as plain loopback
  HTTP with its protected bearer. It adds a separate, default-off remote
  ingress and records why a separate scoped credential preserves the
  other-account boundary that an uncredentialed loopback gateway would lose.
- The retained “no automatic review upload” statement gains one exception: a
  user-enabled remote client sends a requested review from an exactly
  authorized tailnet host to the one canonical store. Telemetry, cloud sync,
  background upload, and Funnel remain absent.
- [`review-handoff-format.md`](../../docs/developer/review-handoff-format.md)
  defines `remote-agent` and optional `review.creationReceipt`. It does not
  define CLI invocation identity or a canonical subset of review fields;
  retry recovery is a transport protocol, not portable document semantics.
- [`privacy/index.html`](../../docs/user/privacy/index.html) changes when the
  gateway first becomes reachable. It names the opt-in path, data sent,
  Tailscale dependency, canonical-host storage, remote-source boundary, and certificate
  name disclosure.

The dedicated gateway credential protects the loopback ingress without replacing
or exposing the local bearer service. Glossary changes wait until PR finalization, when
recurring terms can be judged from actual implementation.

## Complexity-brake dispositions

- Gateway protocol: **narrow** to one capability, one scoped challenge-response
  credential, one fixed loopback listener, and a fixed author-agent route set.
- Remote-client journal: **narrow** to an invocation fingerprint, raw key, the digest
  history of sent request bodies, canonical URL, operation state, and
  eventual receipt; no review body or discovered metadata.
- Creation idempotency: **fix** because persisted creation followed by
  response loss otherwise duplicates primary review data.
- Recovery notification: **narrow** to returning the stored receipt; no
  replay or new renderer event.
- Background process: **decline**; the gateway lives in canonical Markover.
- Compatibility/local fallback: **decline** under the pre-preview policy.
- General-user onboarding: **defer** until the real pilot and variant matrix.

## Verified current seams

1. `markover open` reads/parses the source and discovers Git/thread metadata
   on the agent host ([markover.ts](../../scripts/markover.ts#L1539)).
2. The CLI currently resolves and starts a local instance before posting. Its
   canonical routing preflight is vacuous when `instance.checkout` is absent
   ([canonical-maintenance.ts](../../src/canonical-maintenance.ts#L340)).
3. The local service authenticates before route/body handling. Its create
   route hardcodes `origin: agent`
   ([local-service.ts](../../src/local-service.ts#L371)); `ReviewCreateInput`
   already accepts and validates an origin
   ([review-store.ts](../../src/review-store.ts#L50)). Receipt lookup is new.
4. `open` and `pending` construct review URLs client-side today; the service
   does not return the canonical URL
   ([markover.ts](../../scripts/markover.ts#L1605),
   [markover.ts](../../scripts/markover.ts#L1690)).
5. Forwarding mutations through the current service core retains per-review
   serialization, autosave, store persistence, observation propagation,
   renderer publication, and shutdown barriers.
6. A repeated `created` event is not a neutral upsert: `sendManagedReview`
   resolves project context, enqueues incoming-review notification, reinstalls
   the menu, and creates the main window if absent
   ([main.ts](../../src/main.ts#L1343)). Recovery therefore must not emit it
   again. Note the same path invokes project context discovery, so
   remote-origin non-dereference must hold on the create/publication path,
   not only later restoration.

Canonical reviews, attachments, and settings remain under the canonical host’s Application
Support root. [`SettingsStore`](../../src/settings-store.ts#L15) remains the only
serialized atomic settings writer.

## Reuse versus new work

| Concern | Disposition |
| --- | --- |
| Lifecycle mutations and serialization | Reuse the local-service mutation core and one `ReviewStore`. |
| Autosave, observations, publication, shutdown | Reuse existing hooks and barriers. |
| Request bound | Reuse the existing 16 MiB JSON limit. |
| Attachment containment | Reuse `InternalAttachmentAllowlist` rules from persisted artifact entries ([internal-protocol.ts](../../src/internal-protocol.ts#L114)). |
| Store origin input | Reuse; the producer boundary, not the store type, changes. |
| Gateway, scoped credential, remote health | New. Existing local endpoint publication uses a different rotating credential. |
| HTTPS client and remote profile | New. Existing client uses `node:http`. |
| Response bound and remote timeout | New. Current responses are unbounded and the local timeout is 2000 ms. |
| Creation receipt and key recovery | New. Store create always allocates a fresh ID. |
| canonical-host-produced review URLs | New for `open` and every `pending` result. |

## Canonical activation predicate

`identity.kind === canonical` is insufficient: canonical is the fallback when
resolved-instance state is absent, while smoke mode retains that kind. Gateway
startup requires all of:

- canonical identity;
- smoke mode false;
- a configured canonical descriptor whose checkout and blessed branch
  validate;
- exact `markover:` handler inspection that actually executes and is healthy;
- the default-off canonical setting enabled; and
- a fixed loopback-only gateway port plus an owner-only scoped credential
  under the canonical state root.

Remote create fails if routing inspection is vacuous or unhealthy. The canonical host
returns `markover://review/<id>` only after that check. Each remote `pending`
item also contains its canonical-host-produced URL.

The setting lands through all coordinated settings seams: defaults,
normalization, IPC key/validation, and dialog wiring. Tests prove the value is
not silently discarded by `normalizeSettings` and exercise enable, disable,
active-request drain, occupied port, credential modes, smoke, unset
environment, and shutdown.

## Remote route boundary

Allowed remotely:

- authenticated purpose-built remote health;
- `POST /reviews` create and its body-free receipt-recovery mode;
- `POST /reviews/pending`;
- `POST /reviews/:id/handoff`;
- `POST /reviews/:id/edit`;
- `POST /reviews/:id/revise`;
- `POST /reviews/done`; and
- the later referenced-attachment read route.

Authenticated `404` for all other local-service routes, including list-all,
full artifact read by ID, activate, reviewer claim/submit, resolve/unresolve,
and quit. Settings, deletion, cleanup, and canonical maintenance are not HTTP
routes and require no invented gateway exclusions.

Gateway create derives `remote-agent`, rejects any client-supplied origin and
any tree containing managed attachments, applies the 16 MiB request cap and a
response cap, and invokes the existing mutation core. The internal producer
contract accepts `agent` or `remote-agent`; direct contract tests, not
impossible CLI syntax, verify rejection of unsupported producer values.

## Remote source authority

Preserve the remote client host’s absolute source path, content, checksum, and remotely discovered
Git/thread metadata. The path helps the returning agent but gives the canonical host no
filesystem authority.

For `remote-agent`, project restoration returns existing unavailable states
before `readFile`, `realpath`, repository/favicon discovery, or Git. This is
required even when the canonical host contains a different file at the identical absolute
path, and it must hold on every call path — including the create/publication
path itself, which resolves project context before the review is first shown.
The review remains in **Other** for the pilot. Origin remains
lifecycle-neutral, and unknown future origins remain valid portable data.

## Idempotent create protocol

### Initial attempt

1. Before metadata discovery is sent, the remote client host creates a high-entropy key and a
   mode-restricted journal entry identified by a SHA-256 fingerprint of
   stable command inputs: remote profile, resolved source path, summary, and
   explicit identity arguments. The entry is created with exclusive-create
   (`wx`) semantics; a concurrent identical invocation loses cleanly and
   reports the in-progress entry rather than minting a second key.
2. The remote client host builds the complete create body once, records its SHA-256 digest as
   the first entry in the journal’s digest history, and sends the key,
   digest, and body.
3. The gateway verifies the body digest, serializes receipt lookup/create
   with other create operations, persists the artifact plus:

```json
{
  "creationReceipt": {
    "version": 1,
    "keyDigest": "sha256:...",
    "requestDigest": "sha256:..."
  }
}
```

4. The canonical host publishes once and returns the review ID, status, and canonical URL;
   the remote client host marks the journal entry complete.

### Uncertain retry

1. An unresolved matching journal entry causes a body-free recovery request
   with the raw key and original request digest **before** source reread or
   metadata rediscovery.
2. Recovery runs behind any in-flight create serialization:
   - matching stored key and digest returns the original receipt without a
     `created` replay;
   - matching key with a different digest returns
     `IDEMPOTENCY_CONFLICT` plus the original receipt;
   - no stored key returns `RECEIPT_NOT_FOUND` and proves no review with
     that key committed.
3. Only after `RECEIPT_NOT_FOUND` may the remote client host rebuild metadata/body, **append**
   the new digest to the journaled history, and retry creation with the same
   unused key.
4. **Own-attempt conflict recovery.** If a create or recovery returns
   `IDEMPOTENCY_CONFLICT` and the original receipt’s request digest matches
   any superseded digest in the journal’s history for that key, the conflict
   is the client’s own earlier attempt committing late (for example, a
   delayed first request landing after a `RECEIPT_NOT_FOUND` rebuild). The
   client recovers it as a success, returning the original review, and marks
   the entry complete. A conflict whose digest matches nothing in the history
   remains a genuine fail-closed conflict with the original receipt reported
   for explicit recovery.

The store recovers by scanning its own reviews for key digests; it adds no
index table, sidecar, or writer. Duplicate stored key digests fail closed and
identify the affected local reviews. A completed journal entry never
suppresses a later intentional `open`; a new invocation receives a new key.

This protocol tolerates volatile session or PR metadata without defining a
partial portable identity and without storing the body, self-recovers the
delayed-delivery race, and makes recovery observable without triggering a
second incoming-review prompt. Because recovery never replays `created`, its
visibility backstop is explicit: the returned deep link selects the review,
and a canonical-host relaunch republishes every persisted review.

## Agent commands and failures

The remote profile is resolved before both public app bootstrap and
command-layer instance resolution. The Intel remote client host neither downloads nor launches
Markover.

The new HTTPS client has explicit connect/response timeouts and a response
cap. It distinguishes:

- DNS/TLS/connect failure before send, disabled gateway, or incompatible
  health: `REMOTE_CANONICAL_UNAVAILABLE` or a specific preflight error;
- possible loss after mutation send: `REQUEST_UNCERTAIN` with exact journaled
  recovery;
- missing/malformed capability: one redacted pre-body rejection;
- excluded route: authenticated `404`;
- unsupported origin/attachment-bearing create: pre-storage validation
  failure;
- receipt mismatch: `IDEMPOTENCY_CONFLICT`, auto-recovered only on an
  own-attempt digest-history match; and
- absent uncertain receipt: internal `RECEIPT_NOT_FOUND`, followed by one
  safe reconstructed create.

`open`, `pending`, `get`, `edit`, `revise`, and `done` retain normal syntax.
Metadata discovery occurs on the remote client host under the canonical host’s health-time policy snapshot.
`get`/`edit`/`revise`/`done` retain existing transitions; same-state retries
are byte-stable only without `pullRequestStatus`, while `--pr-status` may
update observation timestamps.

## Attachments

Attachments pasted by the human stay in the canonical host’s managed review directory.
Remote handoff projects exact referenced attachments as capability-protected
HTTPS URLs and omits canonical-host paths from that response without modifying stored
JSON or reviewer-agent artifacts.

The route derives candidates from the exact artifact, applies existing
basename, directory, and double-`realpath` checks, rejects
traversal/symlink/orphan/duplicate/cross-review cases, verifies
type/length/checksum, and streams bounded bytes. Remote-client-origin upload remains
excluded; remote create rejects attachment metadata.

## End-to-end acceptance

Run against the canonical host and remote client host, not two development stores.

1. Prove canonical doctor/descriptor/handler health, non-smoke identity, and
   Funnel absent. **Record** the installed Tailscale variant and version and
   **require** version ≥ 1.92 with loopback HTTP proxying and
   `--accept-app-caps` advertised by the installed CLI (at investigation
   time: Standalone 1.102.2, `io.tailscale.ipn.macsys`). Prove the exact
   loopback bind and credential modes, additive Serve targeting that port, no
   LAN/Tailscale-IP Markover listener, and a live Serve → loopback health hop.
2. Grant exact remote-client host alias → the dedicated canonical-host HTTPS port plus the app capability.
   Prove another same-user tailnet node cannot pass Serve authorization;
   prove spoofed remote headers are stripped. As another ordinary local macOS
   account, prove forged proxy headers still fail without a valid challenge
   proof. Prove a fixed-port occupant cannot forge health, obtain the shared
   credential, replay a proof after restart, or forge a JSON response.
   Record that the canonical host same-account/root processes remain inside
   the documented boundary.
3. Copy the scoped gateway credential through a private channel into an owner-only remote
   profile with the exact HTTPS base URL. Complete auth/consent only in
   Safari. Prove HTTP, IP URL, redirect, certificate/name, protocol, and
   canonical-role failures occur before review bytes.
4. Toggle canonical-host discovery off/on. Prove each remote-health snapshot governs
   that command and explicit thread identity works in both states.
5. Open a sentinel document. Assert one canonical-host directory, no remote-client-host
   store/settings, remote origin, portable receipt digests, exact source
   snapshot, and the canonical host URL. Directly test the producer contract rejects
   unsupported origins and gateway bodies cannot override `remote-agent`.
6. Put different content at the same canonical-host absolute path. Prove the canonical host performs
   no source/Git discovery and returns unavailable/Other — asserted on the
   create/publication path itself, before any UI interaction.
7. Open the URL on the canonical host. Add feedback and a screenshot while editing; `get`
   on the remote client host returns all feedback and a short-lived,
   attachment-and-gateway-scoped private URL, omits the canonical-host path,
   leaves stored JSON unchanged, and denies another node. Fetch the bytes with
   remote `get-attachment` and prove the shared client's response
   authentication, MIME, and projected-checksum checks reject a fixed-port
   imposter.
8. Exercise `edit → get → revise` on the same review and PR-observed `done`
   on matching reviews only; no source file on the canonical host changes.
9. Lose the initial response after commit and after publication. Rerun the
   exact command after session/PR metadata changes; prove key-first recovery
   returns one review without rereading/rebuilding a body and without another
   incoming notification, that the returned deep link selects the review, and
   that it is present after a canonical-host relaunch. Prove recovery waits behind an
   in-flight create, missing receipt permits one rebuilt create, a delayed
   first request landing after a rebuild is auto-recovered through the
   journal’s digest history, a mismatched foreign digest conflicts with the
   original receipt, duplicate stored key digests fail closed, and two
   concurrent identical invocations share one journal entry and key.
   Exercise uncertain retries for the other mutations including the
   `--pr-status` caveat.
10. Disable/re-enable the gateway and quit/relaunch the canonical host with editing and
    pending-agent reviews. Prove the remote client host fails closed while unavailable and the
    unchanged Serve configuration reaches the recreated loopback listener afterward.

Acceptance requires the real two-host grant, Serve-to-loopback hop, deep
link, attachment bytes, enable/disable, and restart.

## Four-PR implementation stack

### Slice A — Portable create and remote-source safety

Base: `main`.

Done when:

- decisions and handoff-format docs define the remote seam, `remote-agent`,
  and the optional portable receipt without defining CLI retry identity;
- the trusted create producer boundary derives/validates `agent` or
  `remote-agent` while portable readers remain open-string compatible;
- ReviewStore serializes initial create and body-free receipt recovery
  through its one store, scans receipts without another index, detects
  mismatch and duplicate digests, and never replays `created` on recovery;
- remote project restoration returns unavailable before all filesystem/Git
  work, on the create/publication path as well as later restoration; and
- tests cover additive preservation, reviewer round trips, origin consumers,
  producer-value rejection, colliding paths through the publication path,
  create/recover races, exact-body digest verification,
  missing/mismatched/duplicate receipts, no notification replay, and
  unchanged ordinary local create.

Excludes gateway transport, Tailscale, remote CLI, attachments, and reachable ingress.

### Slice B — Canonical gateway and trust boundary

Base: Slice A.

Done when:

- the setting lands through defaults, normalizer, IPC validation, and dialog;
  its value persists and safely owns live loopback lifecycle under the
  strengthened canonical predicate;
- credential modes, exact loopback bind, occupied port, other-account denial,
  active drain, shutdown, smoke, and unset-environment cases are covered;
- the gateway requires the Serve capability and a fresh scoped request proof
  before route/body handling, proves JSON responses, and never transmits the
  shared gateway credential;
  implements only the fixed author allowlist plus create recovery, and
  returns authenticated `404` elsewhere;
- remote health exposes protocol/canonical identity and the canonical host’s discovery
  policy without process/path detail;
- create pins remote origin, rejects attachments, uses the existing mutation
  core, requires non-vacuous routing, and returns canonical URLs within
  request/response bounds; and
- decisions, privacy page, developer security docs, and ordinary protocol-2
  regression tests truthfully cover the reachable default-off ingress.

Excludes the remote client host CLI, policy automation, Funnel, reviewer routes, and
attachments.

### Slice C — Intel-safe remote author CLI

Base: Slice B.

Done when:

- the profile resolves before both local-start seams;
- the bounded HTTPS client verifies remote identity, consumes health policy,
  and has pre-send versus uncertain error classes;
- normal `open`, `pending`, `get`, `edit`, `revise`, and `done` use the canonical host
  while local discovery remains on the remote client host;
- the restricted journal uses exclusive entry creation, implements key-first
  body-free recovery before any rebuild, appends superseded digests, and
  auto-recovers own-attempt conflicts through that history while storing no
  review body/metadata; and
- tests cover Intel bootstrap, all commands, discovery snapshots, limits,
  timeouts, incompatible identity, create/recover races, concurrent
  invocations, digest-history recovery, restart, and zero local app/store
  creation.

Excludes attachment retrieval, reviewer mode, upload, sync, and auth
automation.

### Slice D — Private attachments and real pilot

Base: Slice C.

Done when:

- remote `get` projects only checked referenced attachments as private URLs
  and leaves persisted/reviewer artifacts unchanged;
- remote `get-attachment` retrieves one selected attachment through the shared
  response-authentication, MIME, size, and checksum checks, writes only
  verified bytes to a new explicit output file, and prints no credential or
  private URL;
- focused tests cover traversal, symlink swap, orphan, duplicate and
  cross-review metadata, checksum/length mismatch, interrupted streaming,
  unauthorized nodes, and retry;
- the full two-host acceptance test passes; and
- the promotion note records the exact Tailscale variant/version proven and
  remaining onboarding constraints.

Excludes upload, public exposure, sync, source editing, project relinking,
and a second canonical store.

## General-user promotion

After the pilot, an advanced bring-your-own-Tailscale release requires a
fresh-machine doctor proving supported platforms, installed Serve loopback/cap
behavior, exact-device authorization/revocation, Safari-only auth, privacy/CT
disclosures, and failure without fallback. The support matrix uses both
current official documentation and executable capability tests; it does not
extrapolate from the canonical host or conflate file serving with reverse
proxying.

Cross-user collaboration, policy automation, internet relay, and OIDC remain
separate decisions.

## Alternatives

| Alternative | Disposition | Reason |
| --- | --- | --- |
| Sync Application Support | Decline | Competing writers and non-atomic lifecycle sync. |
| Canonical Markover on the remote client host | Decline | Breaks one canonical app/store/UI. |
| Copy local service credentials | Decline | Rotating full-access capability becomes a network secret. |
| Uncredentialed loopback gateway | Decline | Other local accounts can connect and forge proxy headers. |
| Challenge-response loopback gateway | Accept for pilot | The shared credential restores the account boundary without crossing loopback or exposing the full local-service credential; single-use proofs also survive fixed-port takeover safely. |
| Direct Tailscale-IP listener | Decline | Widens listener and duplicates TLS/network identity. |
| Tailscale SSH wrapper | Defer | Broader shell authority and incomplete review/attachment contract. |
| OIDC/tsidp | Defer | Adds an unnecessary second auth lifecycle for the pilot. |

The finite recommendation remains one remote client, one tailnet-only
authenticated hop, one canonical gateway, and the existing single writer.
