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

## Stored review data

Canonical managed reviews live under `reviews/<review-id>/`. A review directory
contains `review.json` plus attachment files when present. Review JSON may
contain the complete source, parsed tree, annotations, source-edit proposals,
attachment metadata, state, timestamps, repository provenance, and agent-thread
provenance. `settings.json`, service discovery records, and startup diagnostics
also live beneath the Application Support root.

Source proposals never rewrite the original reviewed Markdown. Review and
attachment persistence is owned by
[`src/review-store.ts`](../../src/review-store.ts), with review creation paths
in [`scripts/open-review.ts`](../../scripts/open-review.ts). Storage behavior is
covered by [`test/review-store.test.ts`](../../test/review-store.test.ts) and
[`test/open-review.test.ts`](../../test/open-review.test.ts).

Historical review JSON and attachments are preserved unless deletion is
explicitly in scope. During pre-MVP development, do not add fallback readers,
dual writers, migrations, or a promise that the newest app opens every older
artifact without concrete evidence of active external use and maintainer
approval.

## Network boundary

Ordinary review handling has no telemetry, analytics, cloud synchronization,
or automatic review upload. Deliberate installation or update actions may
download release material from npm or GitHub. Remote Markdown images remain
inert until the user explicitly previews one, at which point the image host
receives an ordinary HTTP or HTTPS request.

An authenticated `get` returns review content to the requesting local agent.
Markover does not upload that handoff, but the receiving tool's storage,
logging, sharing, and network behavior is outside Markover's boundary.

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
