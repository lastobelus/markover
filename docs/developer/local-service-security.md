# Local service security and storage mechanics

This is the contributor-facing technical reference for Markover's loopback
service and per-user storage boundary. The user-facing contract is
[Privacy, storage, and recovery](https://lastobelus.github.io/markover/privacy/).
Keep that page focused on consequences and actions; keep exact formats,
ordering, invariants, and enforcing evidence here.

## Trust boundary

Canonical Markover state is scoped to the current macOS account under:

```text
~/Library/Application Support/Markover/
```

This boundary excludes other ordinary macOS accounts. It does not isolate
Markover from another process running as the same user, an administrator, or
root. Fast User Switching therefore yields independent state, endpoint
records, and credentials for each account.

The bootstrap download cache is separate:

```text
~/Library/Caches/Markover/
```

Deleting the cache must not delete reviews or settings. Deleting Application
Support is destructive user-data removal, not a reinstall step.

The path contract and platform fallbacks are implemented in
[`src/service-endpoint.ts`](../../src/service-endpoint.ts). The public bootstrap
cache default is implemented in
[`packages/cli/src/bootstrap.ts`](../../packages/cli/src/bootstrap.ts).

## Capability and discovery records

Each service process creates:

- a random 32-byte capability encoded as 43-character base64url; and
- a random UUID instance identity.

The Application Support root is created and corrected to POSIX mode `0700` on
supported non-Windows systems. `service.json` and `service.token` are flushed
to private temporary files with mode `0600` and atomically renamed into place.
The public endpoint record contains protocol version, instance ID, port, and
PID. The separate private credential record contains protocol version,
instance ID, and capability.

The instance ID is a non-secret freshness and identity check. It helps a client
avoid sending the capability to an unrelated ordinary listener, but it is not
authentication against a process already inside the same-user trust boundary.

Primary implementation and evidence:

- [`src/service-endpoint.ts`](../../src/service-endpoint.ts)
- [`src/local-client.ts`](../../src/local-client.ts)
- [`test/service-endpoint.test.ts`](../../test/service-endpoint.test.ts)
- [`test/local-service.test.ts`](../../test/local-service.test.ts)

## Request authorization order

Only exact `GET /health` is public. It returns service status, protocol version,
and the temporary instance ID. Query variants, other methods, unknown routes,
and every review operation require exactly one syntactically valid Bearer
capability.

Authorization is checked before URL route handling and before request-body
parsing. The server compares the fixed-length presented value with the expected
capability using a timing-safe comparison. Failed authentication returns the
same bounded response for missing, malformed, and mismatched credentials.

Before an authenticated request sends its capability, the client reads the
private endpoint and credential records, performs a fresh public health check,
and requires the health instance ID to match both records. Successful health
checks are not cached between authenticated requests.

The route order is implemented in
[`src/local-service.ts`](../../src/local-service.ts); client preflight is in
[`src/local-client.ts`](../../src/local-client.ts). Real-HTTP coverage in
[`test/local-service.test.ts`](../../test/local-service.test.ts) enumerates all
current non-health routes and proves that authorization happens before bodies
or actions are processed.

## Diagnostics and redaction

Rejected-request logging is disabled by default. When the user enables it, the
diagnostic callback receives only:

- the request method;
- the URL pathname without its query; and
- a coarse `missing`, `malformed`, or `mismatch` reason.

It must never receive or log the capability, Authorization field, request
body, query, or review content. A diagnostic callback failure cannot change an
authorization rejection. The user-visible setting and copy live in
[`src/index.html`](../../src/index.html), while callback isolation is enforced
and tested in [`src/local-service.ts`](../../src/local-service.ts) and
[`test/local-service.test.ts`](../../test/local-service.test.ts).

## Optional remote canonical gateway

The default-off `remoteCanonicalGatewayEnabled` setting is the only application
switch for remote ingress. It can create a listener only when the running app
is canonical rather than development or smoke, the configured canonical
checkout and blessed branch still validate, and exact `markover:` handler
inspection executes and reports healthy. The gateway listens on the fixed
backend `127.0.0.1:39831`, never on a LAN or Tailscale address. Startup refuses
an occupied port. If a saved opt-in cannot meet those checks during startup,
Markover turns it off and continues with the local app and service available.

Tailscale Serve terminates HTTPS and proxies HTTP to that loopback listener. Markover
requires exactly one forwarded `Tailscale-App-Capabilities` JSON header with a
nonempty `lastobelus.com/cap/markover-remote-client` grant. Missing, malformed,
wrong, duplicate, or additional forwarded capabilities receive one bounded
rejection before URL parsing or body reads. The gateway also requires its own
secret from the remote profile. The canonical credential is stable across
restarts in owner-only `remote-gateway.token`; the remote profile must also be
an owner-only regular file. The secret is never sent over HTTPS or loopback.
Instead, health returns a short-lived nonce plus a server proof. The client
verifies that proof, signs the nonce, method, path, and exact body digest, and
the gateway consumes a valid nonce once before reading the body. JSON responses
carry a proof bound to the nonce, status, and exact response bytes.

This challenge-response exchange preserves the other-account boundary because
a local account can reach loopback and forge proxy headers but cannot read
either protected file. It also prevents a process that occupies the fixed port
while Markover is stopped from impersonating health, harvesting the shared
secret, replaying a request into a restarted gateway, or forging a JSON
response. Same-account processes, administrators, and root remain inside the
documented trust boundary.

The authenticated remote surface is deliberately smaller than local protocol
2:

```text
GET  /health
GET  /reviews/<review-id>/attachments/<attachment-id>
POST /reviews
POST /reviews/pending
POST /reviews/<review-id>/handoff
POST /reviews/<review-id>/edit
POST /reviews/<review-id>/revise
POST /reviews/done
```

Every other method or route receives authenticated `404`, including list-all,
artifact read by ID, activate, reviewer claim/submit, resolve/unresolve, and
quit. Remote health returns only protocol name/version, canonical role and
scheme, and the current `discoverAgentThreadFromLocalSessions` policy. It omits
the process, executable path, port, instance ID, and filesystem paths.

The remote gateway, Tailscale hop, and client never receive or publish
`service.token`. The dedicated gateway credential authorizes only this fixed
remote surface; it is not accepted by local protocol 2. After capability,
challenge proof, and route checks the gateway uses the
canonical process's in-memory local-service identity for a loopback request,
preserving the existing mutation queues, renderer
barriers, `ReviewStore`, notifications, and shutdown behavior. Remote create
uses a 43-character base64url `Idempotency-Key` plus
`Markover-Request-Digest: sha256:...`; an empty exact `POST /reviews` is
body-free receipt recovery. The gateway rejects any client-supplied `origin`
or attachment metadata, derives `remote-agent`, rechecks exact canonical
routing before accepting review bytes, and returns canonical-host-produced
`markover://review/...` URLs for create/recovery and every pending result.

Request JSON is capped at 16 MiB and response JSON at 32 MiB, leaving room for
the review envelope Markover adds during creation. Managed attachments use the
same 32 MiB ceiling at creation, remote projection, and download. Only one
remote request is active at a time. Disable and shutdown stop admission, drain
that bounded request and close the loopback listener. Tailscale
grants, Serve configuration, login/consent, HTTPS host selection, and
certificate issuance remain manual; Markover never enables Funnel or a direct
Tailscale-IP listener.

Remote author handoffs project each referenced managed image to a private
attachment route and remove the canonical filesystem path from that response.
The remote client accepts only that exact review-and-attachment route and
resolves it against its already-pinned canonical HTTPS profile; an absolute or
cross-origin gateway value fails closed, as does any missing, expired,
malformed, or additional query authorization. Projection and download
reload the current artifact, require one exact attachment reference, reuse the
managed attachment directory/basename and double-realpath allowlist, reject
symlinks, and open the checked file without following links. Before returning
bytes, the gateway verifies the bounded file length, SHA-256 checksum, and PNG
or JPEG signature. Stored JSON and reviewer-agent artifacts are not rewritten.
The projected URL carries a five-minute proof bound only to that review,
attachment, and running gateway instance; it does not reveal the shared gateway
credential or authorize JSON operations. A restart invalidates outstanding
URLs, and a new handoff returns fresh ones. The download route repeats the Serve
capability check before route selection and returns private, non-cacheable,
nosniff responses with a proof over the exact bytes. The shared remote client
checks that proof, MIME type, and projected attachment checksum.

The advanced-user pilot gate remains the finite two-host acceptance in issue
#187. The investigated canonical configuration is Tailscale Standalone 1.102.2
with a loopback HTTP Serve target and `--accept-app-caps`; general-user
promotion still requires the live two-host test, exact-device
authorization/revocation, secure credential transfer, manual Safari consent
where required, and a fresh-machine compatibility doctor. The minimum
supported capability-forwarding version is 1.92.

Primary implementation and evidence:

- [`src/remote-gateway.ts`](../../src/remote-gateway.ts)
- [`src/remote-gateway-auth.ts`](../../src/remote-gateway-auth.ts)
- [`src/remote-gateway-credential.ts`](../../src/remote-gateway-credential.ts)
- [`src/remote-attachments.ts`](../../src/remote-attachments.ts)
- [`src/main.ts`](../../src/main.ts)
- [`test/remote-gateway.test.ts`](../../test/remote-gateway.test.ts)
- [`test/local-service.test.ts`](../../test/local-service.test.ts)

## Stored review data

Canonical managed reviews live under `reviews/<review-id>/`. A review directory
contains `review.json` plus attachment files when present. Review JSON may
contain the complete source, parsed tree, annotations, source-edit proposals,
attachment metadata, state, timestamps, repository provenance, and agent-thread
provenance. `settings.json`, service discovery records, and startup diagnostics
also live beneath the Application Support root.

Source proposals never rewrite the original reviewed Markdown. Review and
attachment persistence is owned by
[`src/review-store.ts`](../../src/review-store.ts). Managed review creation is
addressed through [`scripts/markover.ts`](../../scripts/markover.ts) and
[`src/local-service.ts`](../../src/local-service.ts). Storage and creation
behavior are covered by
[`test/review-store.test.ts`](../../test/review-store.test.ts),
[`test/markover-cli.test.ts`](../../test/markover-cli.test.ts), and
[`test/local-service.test.ts`](../../test/local-service.test.ts).

Historical review JSON and attachments are preserved unless deletion is
explicitly in scope. During pre-MVP development, do not add fallback readers,
dual writers, migrations, or a promise that the newest app opens every older
artifact without concrete evidence of active external use and maintainer
approval.

## Network boundary

Ordinary review handling has no telemetry, analytics, cloud synchronization,
or automatic review upload. Deliberate installation or update actions may
download release material from npm or GitHub. Inline Markdown image syntax is
inert by default. Only an embedded `data:` image can open through its explicit
preview control. Relative paths, local file paths, HTTP(S) URLs, and malformed
sources remain unavailable; choosing their controls makes no network request.

An authenticated `get` returns review content to the requesting local agent.
Markover does not upload that handoff, but the receiving tool's storage,
logging, sharing, and network behavior is outside Markover's boundary.

An authenticated `get-for-review` returns the same portable artifact to an
agent acting as reviewer and atomically freezes it in `agent-reviewing`.
`submit` accepts that complete artifact as one JSON body and atomically records
the validated result as `reviewed`. Both routes remain inside the same-user
loopback capability boundary; reviewer provenance is descriptive and does not
turn the capability into authenticated agent identity.

## Agent-review service operations

The authenticated routes are:

```text
POST /reviews/<review-id>/get-for-review
POST /reviews/<review-id>/submit
```

The claim body may contain nullable `agentThread` and optional
`pullRequestStatus`. The submit body contains one `artifact` property. The
existing 16 MiB exact request-body limit applies. `get-for-review` rejects a
baseline whose encoded submit body cannot fit that limit; the CLI preflights a
file or buffered stdin body. If new annotations make the body too large, the
review remains `agent-reviewing` and recovery is to shrink the annotations and
retry or ask the human to cancel with `edit`.

Claim, submit, edit, PR-driven done, and other operations for one review use
the existing per-review service queue and store serialization. The renderer
snapshot barrier runs before a first claim and may persist pre-existing human
edits. An inflight `agent-reviewing` review is skipped by PR-driven done and
uses the existing inflight-agent warning before Trash. A settings change cannot
change an inflight claim because the effective mode is persisted in the
portable artifact.

The durable submit commit point is the atomic replacement of `review.json`
with the validated `reviewed` artifact. After that commit, the main process
publishes the complete artifact to the in-memory session and active renderer;
status-only publication is insufficient because feedback and source proposals
changed. Success is returned only after publication acknowledges. Any
transport loss or publication failure after commit is `REQUEST_UNCERTAIN`.
Repeating the exact submit republishes the accepted artifact and returns the
original `{reviewId,status}` receipt; different content returns conflict. The
same receipt is recoverable after PR-driven `done`: Markover republishes the
immutable terminal artifact, returns the original `reviewed` status, and
ignores only the lifecycle and pull-request observation fields that `done`
changed while comparing the retry. Pull-request identity, claim identity,
review content, and preserved additive fields must still match. The
same uncertain rule applies when a claim commits but its artifact response or
renderer publication is lost: retry `get-for-review` using only the review ID.

## Durability and recovery invariants

Managed reviews use a per-review `ReviewAutosaveCoordinator`. Its default
`autosaveMaximumDelayMs` is 2,000 milliseconds. Sustained-edit writes begin at
most 1,500 milliseconds apart, leaving a 500-millisecond persistence budget;
shorter configured windows reserve half their duration. The persisted setting
accepts whole numbers from 100 through 60,000 and is read once at startup.

Each review has an independent leading-and-trailing throttle. The first change
after an idle window writes promptly. Later changes replace the pending
snapshot, so sustained input does not create an unbounded queue and the newest
eligible snapshot becomes the trailing write. `saveNow` supersedes scheduled
state and resolves only after its exact supplied snapshot is durable.

A failed write retains the newest snapshot and retries with exponential
backoff capped at 30 seconds. A failed write or one that exceeds its reserved
persistence budget raises the persistent durability warning and suspends the
maximum-loss claim until current state becomes durable.

Authenticated handoff and reopen transitions pass through an exact persistence
barrier before the service acknowledges success. Attachment bytes become
durable before saved review JSON can refer to them. Graceful shutdown blocks
new service and attachment mutations, captures every loaded editable review,
drains attachment mutations and autosaves, closes the local service, and then
quits. After five seconds without a successful barrier, the UI offers Retry
Quit, Cancel Quit, or Quit Anyway.

The demonstrated default guarantee is therefore limited to an app-process
crash while Markover remains responsive and local storage remains healthy.
Power loss, operating-system or hardware failure, and unhealthy or unusually
slow storage are excluded.

Primary implementation and evidence:

- [`src/review-autosave.ts`](../../src/review-autosave.ts) implements
  coalescing, exact barriers, persistence budgets, retry, and recovery state.
- [`src/main.ts`](../../src/main.ts),
  [`src/durability-shutdown.ts`](../../src/durability-shutdown.ts), and
  [`src/local-service.ts`](../../src/local-service.ts) enforce attachment,
  handoff/reopen, and shutdown ordering.
- [`test/review-autosave.test.ts`](../../test/review-autosave.test.ts) proves
  the default bound, slow-write suspension, latest-state retention, exact
  barriers, independent reviews, and the 30-second retry cap.
- [`test/durability-integration.test.ts`](../../test/durability-integration.test.ts)
  protects the cross-process ordering and quit barrier.
- [`test/durability-crash.test.ts`](../../test/durability-crash.test.ts) and its
  [killed-child fixture](../../test/fixtures/durability-crash-child.ts) restore
  rapid edits, editing and pending-agent states, multiple reviews, and an
  attachment after termination without cleanup.
