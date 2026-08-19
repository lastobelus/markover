# Remote agents posting to Airy’s canonical Markover

Status: implementation-ready plan; this document changes no product code or
Tailscale configuration.

Implementation tracking: create one issue for the four stacked implementation
PRs before Slice A. This plan-only PR owns only the investigation record.

## Outcome

Build one opt-in **remote-client → remote-canonical seam**:

```text
htulo Markover CLI
  → HTTPS to Airy’s exact *.ts.net name
  → Tailscale Serve (tailnet-only; never Funnel)
  → mode-restricted Unix socket owned by canonical Markover
  → constrained gateway in the canonical app
  → existing authenticated local-service mutation core
  → existing queues, ReviewStore, SettingsStore, renderer, and UI
```

Airy remains the only Markover app, settings writer, review store, attachment
store, renderer, and lifecycle authority. htulo runs the architecture-neutral
CLI and Tailscale only. It never launches Markover, creates a review store, or
receives Airy’s local bearer token.

This is a narrow feature, not configuration-only support. The first delivery is
an Airy/htulo pilot. General-user promotion follows only after the installed
Tailscale variants, setup doctor, revocation, and privacy disclosures are
proven. Unsupported transport fails closed; it never falls back to Funnel,
direct Tailscale-IP binding, a second store, or a loopback gateway.

## Product decisions

1. **Remote source state is `unavailable`.** Reviews created through the remote
   gateway use `origin: remote-agent`. Airy returns existing unavailable source
   and project states before filesystem or Git access. A new renderer/IPC state
   has no pilot behavior to justify it.
2. **Creation receipts are portable digest records.** An optional
   `review.creationReceipt` contains a version, the digest of a high-entropy
   idempotency key, and the digest of the exact initial request bytes. The raw
   key lives only in htulo’s restricted journal and authenticated requests.
3. **Uncertain `open` retries recover by key before rebuilding a body.** The
   client first performs a body-free recovery mode on remote `POST /reviews`
   using its journaled key and original request digest. This avoids both
   storing review contents locally and inventing a lossy canonical subset of
   creation fields. The journal keeps a digest **history** per key, so a
   conflict against the client’s own superseded attempt self-recovers (see
   protocol below).
4. **Recovery does not replay `created`.** A key match returns the original
   review ID, status, and Airy URL without sending another incoming-review
   notification. The store and exact deep link are the recovery sources of
   truth; an Airy relaunch republishes persisted reviews. This is grounded in
   code: the `created` path resolves project context, enqueues an
   incoming-review notification, reinstalls the menu, and creates the main
   window if absent ([main.ts](../../src/main.ts#L1343)) — replay is not a
   neutral upsert.
5. **Ingress derives origin.** Ordinary local create remains `agent`; the
   remote gateway pins `remote-agent` and rejects any remote body claim. The
   internal producer contract accepts only those two currently supported write
   values, while portable readers continue accepting unknown nonblank origins.
6. **Airy governs optional session discovery.** Authenticated remote health
   carries a snapshot of Airy’s canonical
   `discoverAgentThreadFromLocalSessions` setting. That snapshot governs
   htulo-local discovery for the command; explicit thread identity remains
   authoritative. No htulo settings writer or settings route is added.
7. **The gateway setting is canonical and live.** Enable creates the owned
   socket. Disable stops new requests, drains the bounded active request,
   closes the gateway, and removes only its socket. Development and smoke
   instances cannot activate it.

## Tailscale evidence and boundary

Verified live during this investigation: Airy runs Tailscale 1.102.2 as the
signed Standalone system-extension variant (`codesign` identifier
`io.tailscale.ipn.macsys`; its network extension is the running process). The
installed CLI explicitly documents:

```text
On Unix-like systems, you can also specify a Unix domain socket
(e.g., unix:/tmp/myservice.sock).

Expose a service listening on a Unix socket (Linux/macOS/BSD only):
tailscale serve unix:/var/run/myservice.sock
```

It also advertises `--accept-app-caps`. This is stronger pilot evidence than
an inference from the online examples. Tailscale’s macOS restriction on
directly serving files and directories does not establish a restriction on
reverse-proxying an HTTP service through a Unix socket; those are different
Serve targets. Two things keep the live Serve → Markover-socket hop as
mandatory acceptance: the current online
[Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve)
does not document the Unix target as clearly as the installed CLI
(documentation drift, recorded here rather than treated as a restriction),
and the process that dials the socket at request time is the network
extension, not the CLI that printed the help — extension reachability of a
socket under the user’s state root is proven only by the live hop.

Use Tailscale Serve, never Funnel:

- Pin Airy’s exact HTTPS `*.ts.net` base URL and expected Markover protocol,
  `role: canonical`, and `scheme: markover`.
- Require normal certificate and hostname validation. Reject HTTP, IP URLs,
  redirects, protocol mismatch, and non-canonical role before private bytes.
- Forward one application capability, for example
  `lastobelus.com/cap/markover-remote-client`; forwarding requires Tailscale
  1.92 or newer
  ([Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers)).
- Bind TCP 443 and the capability to the exact htulo host selector and exact
  Airy destination. Prefer a readable host alias over a raw Tailscale IP. A
  user-wide selector is too broad because Airy and htulo share one user
  identity ([grant selectors](https://tailscale.com/docs/reference/syntax/grants)).
- Accept the Serve capability before route selection or body parsing. The
  network never receives `service.token`.

Serve strips client-supplied identity/capability headers before forwarding its
own. The socket restores the existing OS-account boundary for direct local
access: its parent is `0700` and the socket is owner-only. Another ordinary
macOS account cannot reach HTTP parsing. A process running as the same
account, an administrator, or root remains inside Markover’s documented local
trust boundary and is not claimed to be isolated.

Any Tailscale login or HTTPS-consent URL is printed for manual Safari use.
Markover does not drive OAuth or edit tailnet policy. HTTPS certificate
issuance publishes Airy’s certificate name to Certificate Transparency, so the
machine name must contain no sensitive information
([HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates)).

## Recorded decisions and documentation

The first implementation stack must deliberately amend existing records:

- [`DECISIONS.md`](../../DECISIONS.md) retains local protocol 2 as plain loopback
  HTTP with its protected bearer. It adds a separate, default-off remote
  ingress and records why its mode-restricted socket preserves the
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
  Tailscale dependency, Airy storage, remote-source boundary, and certificate
  name disclosure.

The Unix socket protects the remote ingress boundary without replacing the
local bearer service. Glossary changes wait until PR finalization, when
recurring terms can be judged from actual implementation.

## Complexity-brake dispositions

- Gateway protocol: **narrow** to one capability, one canonical socket, and a
  fixed author-agent route set.
- htulo journal: **narrow** to an invocation fingerprint, raw key, the digest
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
   does not return Airy’s canonical URL
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

Canonical reviews, attachments, and settings remain under Airy’s Application
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
| Gateway, owned socket, remote health | New. Existing endpoint publication is port-only. |
| HTTPS client and remote profile | New. Existing client uses `node:http`. |
| Response bound and remote timeout | New. Current responses are unbounded and the local timeout is 2000 ms. |
| Creation receipt and key recovery | New. Store create always allocates a fresh ID. |
| Airy-produced review URLs | New for `open` and every `pending` result. |

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
- an owned, mode-restricted socket path under the canonical state root.

Remote create fails if routing inspection is vacuous or unhealthy. Airy
returns `markover://review/<id>` only after that check. Each remote `pending`
item also contains its Airy-produced URL.

The setting lands through all coordinated settings seams: defaults,
normalization, IPC key/validation, and dialog wiring. Tests prove the value is
not silently discarded by `normalizeSettings` and exercise enable, disable,
active-request drain, stale socket, smoke, unset environment, and shutdown.

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

Preserve htulo’s absolute source path, content, checksum, and htulo-discovered
Git/thread metadata. The path helps the returning agent but gives Airy no
filesystem authority.

For `remote-agent`, project restoration returns existing unavailable states
before `readFile`, `realpath`, repository/favicon discovery, or Git. This is
required even when Airy contains a different file at the identical absolute
path, and it must hold on every call path — including the create/publication
path itself, which resolves project context before the review is first shown.
The review remains in **Other** for the pilot. Origin remains
lifecycle-neutral, and unknown future origins remain valid portable data.

## Idempotent create protocol

### Initial attempt

1. Before metadata discovery is sent, htulo creates a high-entropy key and a
   mode-restricted journal entry identified by a SHA-256 fingerprint of
   stable command inputs: remote profile, resolved source path, summary, and
   explicit identity arguments. The entry is created with exclusive-create
   (`wx`) semantics; a concurrent identical invocation loses cleanly and
   reports the in-progress entry rather than minting a second key.
2. htulo builds the complete create body once, records its SHA-256 digest as
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

4. Airy publishes once and returns the review ID, status, and canonical URL;
   htulo marks the journal entry complete.

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
3. Only after `RECEIPT_NOT_FOUND` may htulo rebuild metadata/body, **append**
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
and an Airy relaunch republishes every persisted review.

## Agent commands and failures

The remote profile is resolved before both public app bootstrap and
command-layer instance resolution. Intel htulo neither downloads nor launches
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
Metadata discovery occurs on htulo under Airy’s health-time policy snapshot.
`get`/`edit`/`revise`/`done` retain existing transitions; same-state retries
are byte-stable only without `pullRequestStatus`, while `--pr-status` may
update observation timestamps.

## Attachments

Attachments pasted by the human stay in Airy’s managed review directory.
Remote handoff projects exact referenced attachments as capability-protected
HTTPS URLs and omits Airy paths from that response without modifying stored
JSON or reviewer-agent artifacts.

The route derives candidates from the exact artifact, applies existing
basename, directory, and double-`realpath` checks, rejects
traversal/symlink/orphan/duplicate/cross-review cases, verifies
type/length/checksum, and streams bounded bytes. htulo-origin upload remains
excluded; remote create rejects attachment metadata.

## End-to-end acceptance

Run against Airy canonical and htulo, not two development stores.

1. Prove canonical doctor/descriptor/handler health, non-smoke identity, and
   Funnel absent. **Record** the installed Tailscale variant and version and
   **require** version ≥ 1.92 with the `unix:` Serve target and
   `--accept-app-caps` advertised by the installed CLI (at investigation
   time: Standalone 1.102.2, `io.tailscale.ipn.macsys`). Prove exact socket
   and parent modes, Serve targeting that socket, no LAN/Tailscale-IP
   Markover listener, and a live Serve → socket health hop.
2. Grant exact htulo host alias → exact Airy TCP 443 plus the app capability.
   Prove another same-user tailnet node cannot pass Serve authorization;
   prove spoofed remote headers are stripped. As another ordinary local macOS
   account, prove socket access fails before HTTP. Record that Airy
   same-account/root processes remain inside the documented boundary.
3. Configure htulo’s exact HTTPS profile. Complete auth/consent only in
   Safari. Prove HTTP, IP URL, redirect, certificate/name, protocol, and
   canonical-role failures occur before review bytes.
4. Toggle Airy discovery off/on. Prove each remote-health snapshot governs
   that command and explicit thread identity works in both states.
5. Open a sentinel document. Assert one Airy directory, no htulo
   store/settings, remote origin, portable receipt digests, exact source
   snapshot, and Airy URL. Directly test the producer contract rejects
   unsupported origins and gateway bodies cannot override `remote-agent`.
6. Put different content at the same Airy absolute path. Prove Airy performs
   no source/Git discovery and returns unavailable/Other — asserted on the
   create/publication path itself, before any UI interaction.
7. Open the URL on Airy. Add feedback and a screenshot while editing; `get`
   on htulo returns all feedback and a private checked URL, omits the Airy
   path, leaves stored JSON unchanged, and denies another node.
8. Exercise `edit → get → revise` on the same review and PR-observed `done`
   on matching reviews only; no source file on Airy changes.
9. Lose the initial response after commit and after publication. Rerun the
   exact command after session/PR metadata changes; prove key-first recovery
   returns one review without rereading/rebuilding a body and without another
   incoming notification, that the returned deep link selects the review, and
   that it is present after an Airy relaunch. Prove recovery waits behind an
   in-flight create, missing receipt permits one rebuilt create, a delayed
   first request landing after a rebuild is auto-recovered through the
   journal’s digest history, a mismatched foreign digest conflicts with the
   original receipt, duplicate stored key digests fail closed, and two
   concurrent identical invocations share one journal entry and key.
   Exercise uncertain retries for the other mutations including the
   `--pr-status` caveat.
10. Disable/re-enable the gateway and quit/relaunch Airy with editing and
    pending-agent reviews. Prove htulo fails closed while unavailable and the
    unchanged Serve configuration reaches the recreated socket afterward.

Acceptance requires the real Airy/htulo grant, Serve-to-socket hop, deep
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

Excludes socket, Tailscale, remote CLI, attachments, and reachable ingress.

### Slice B — Canonical gateway and trust boundary

Base: Slice A.

Done when:

- the setting lands through defaults, normalizer, IPC validation, and dialog;
  its value persists and safely owns live socket lifecycle under the
  strengthened canonical predicate;
- parent/socket modes, other-account denial, stale ownership, active drain,
  shutdown, smoke, and unset-environment cases are covered;
- the gateway requires the Serve capability before route/body handling,
  implements only the fixed author allowlist plus create recovery, and
  returns authenticated `404` elsewhere;
- remote health exposes protocol/canonical identity and Airy’s discovery
  policy without process/path detail;
- create pins remote origin, rejects attachments, uses the existing mutation
  core, requires non-vacuous routing, and returns Airy URLs within
  request/response bounds; and
- decisions, privacy page, developer security docs, and ordinary protocol-2
  regression tests truthfully cover the reachable default-off ingress.

Excludes htulo CLI, policy automation, Funnel, reviewer routes, and
attachments.

### Slice C — Intel-safe remote author CLI

Base: Slice B.

Done when:

- the profile resolves before both local-start seams;
- the bounded HTTPS client verifies remote identity, consumes health policy,
  and has pre-send versus uncertain error classes;
- normal `open`, `pending`, `get`, `edit`, `revise`, and `done` use Airy
  while local discovery remains on htulo;
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
- focused tests cover traversal, symlink swap, orphan, duplicate and
  cross-review metadata, checksum/length mismatch, interrupted streaming,
  unauthorized nodes, and retry;
- the full Airy/htulo acceptance test passes; and
- the promotion note records the exact Tailscale variant/version proven and
  remaining onboarding constraints.

Excludes upload, public exposure, sync, source editing, project relinking,
and a second canonical store.

## General-user promotion

After the pilot, an advanced bring-your-own-Tailscale release requires a
fresh-machine doctor proving supported platforms, installed Serve socket/cap
behavior, exact-device authorization/revocation, Safari-only auth, privacy/CT
disclosures, and failure without fallback. The support matrix uses both
current official documentation and executable capability tests; it does not
extrapolate from Airy or conflate file serving with Unix-socket service
proxying.

Cross-user collaboration, policy automation, internet relay, and OIDC remain
separate decisions.

## Alternatives

| Alternative | Disposition | Reason |
| --- | --- | --- |
| Sync Application Support | Decline | Competing writers and non-atomic lifecycle sync. |
| Canonical Markover on htulo | Decline | Breaks one canonical app/store/UI. |
| Copy local service credentials | Decline | Rotating full-access capability becomes a network secret. |
| Stable loopback gateway | Decline | Other local accounts can connect and forge proxy headers unless another credential is added; the socket preserves the existing account boundary. |
| Direct Tailscale-IP listener | Decline | Widens listener and duplicates TLS/network identity. |
| Tailscale SSH wrapper | Defer | Broader shell authority and incomplete review/attachment contract. |
| OIDC/tsidp | Defer | Adds an unnecessary second auth lifecycle for the pilot. |

The finite recommendation remains one remote client, one tailnet-only
authenticated hop, one canonical gateway, and the existing single writer.
