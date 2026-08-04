# Issue 12: First Authorization-Boundary PR

## Outcome

The first PR gives Markover's loopback review API a real capability boundary: callers that can reach `127.0.0.1` but cannot read Markover's protected per-user credential cannot read or mutate reviews. The PR remains independently usable by including the minimum shared-client credential propagation needed for `open`, `get`, and `edit`.

This is the bottom PR only. Robust stale-service recovery, mutual server authentication, exhaustive adversarial verification, and final privacy/data documentation remain in later PRs.

## Threat model

The protected boundary is the OS-account boundary. Markover defends against local callers that can connect to the loopback port but cannot read a `0600` credential inside a `0700` application-data directory.

Malicious processes already running as the same OS user are out of scope. They can ordinarily read the credential and the review JSON directly. Root or otherwise privileged processes are also out of scope.

The service continues to use plain HTTP bound to `127.0.0.1`. Local TLS, browser-specific `Host`/`Origin` checks, CORS permissions, and unauthenticated preflight handling are not added. Markover emits no CORS permission, and only the exact health route is public.

## Service identity and records

Every service-process start receives two independent random values:

- A 256-bit capability generated with Node's cryptographic RNG and encoded as unpadded base64url.
- A non-secret per-start instance ID, represented as a random UUID.

The capability rotates on every service start. It is never persisted as an installation-wide secret and is never passed through an environment variable.

Discovery and authority are deliberately separated into adjacent fixed files:

- `service.json` version 2 contains `version`, `instanceId`, `port`, and `pid`. It contains no secret.
- `service.token` version 1 contains `version`, `instanceId`, and `token`.

Both records are JSON. Clients derive the fixed `service.token` path from the directory containing `service.json`; the endpoint record cannot redirect them to another credential path.

The endpoint and credential must carry the same instance ID. A mismatch is a typed stale-service condition, not a best-effort connection attempt.

## Filesystem boundary

Managed-mode startup creates or tightens Markover's shared application-data directory to mode `0700` before importing reviews, loading settings, creating windows, starting the service, or publishing records.

`service.json`, `service.token`, and their temporary publication files use mode `0600` from creation. Existing overly permissive service-record modes are repaired. The implementation does not rely on the process umask.

Permission, directory, or publication failures are fatal: the new listener is closed and startup stops. Markover never warns and continues with a permissive credential.

Filesystem guarantees are scoped to POSIX systems, covering supported macOS and Ubuntu CI. This PR does not add Windows ACL machinery or claim Windows support.

The PR does not recursively chmod, migrate, rewrite, or delete historical review JSON, attachments, settings, or other descendants. The protected parent directory supplies the account boundary while historical artifacts remain byte-for-byte and mode-for-mode untouched.

## Startup and shutdown lifecycle

After early directory hardening, managed startup proceeds as follows:

1. Generate the per-start capability and instance ID.
2. Start the HTTP server with mandatory authentication already active.
3. Atomically publish `service.token`.
4. Atomically publish `service.json` last as the discovery commit point.
5. Close the listener and fail startup if either publication fails.

Graceful shutdown leaves both records in place as one coherent stale pair, matching the existing stale-endpoint recovery design. The stopped process's token is expired because no later service reuses it.

A missing, malformed, or mismatched credential while the service is running requires a user-coordinated restart in this first PR. The client does not regenerate credentials, weaken authentication, or replace the process automatically. Restarting does not require agents to retrieve inflight reviews first; durable review state is expected to return afterward.

Protocol 2 is a clean break. A currently running protocol-1 app must be restarted. There is no version-1 fallback, dual protocol, optional authentication, migration layer, or automatic old-process replacement.

## Server authorization

`startLocalService` requires an explicit valid capability before it listens. There is no development bypass, environment override, missing-token default, or unauthenticated mode.

Only exact `GET /health` is unauthenticated. It returns the minimal response `{"status":"ok","version":2}` and reveals no instance ID, port, PID, or credential information.

Every other request is authenticated before route matching or body reading. The capability is accepted only through `Authorization: Bearer <token>`. Query parameters, cookies, and request bodies are never credential transports.

Missing, malformed, duplicated, and incorrect authorization values all receive the same structured `401 UNAUTHORIZED` response and a Bearer `WWW-Authenticate` header. Validly shaped tokens are compared with a constant-time operation. Unauthorized callers cannot use `404` responses to probe the route table or force JSON-body processing.

One capability authorizes every non-health route. Read/write scopes, per-review tokens, and multiple secret files would not strengthen the agreed account boundary and are not introduced.

## Client behavior

The shared client encapsulates credential handling. Normal callers neither receive nor pass a token, and `requestJson` does not gain a caller-supplied credential argument.

Every non-health request reads a fresh `service.json` and then `service.token`, validates their versions and required fields, and requires matching instance IDs before attaching the Bearer header. Credentials are not cached globally. Health reads only the endpoint record.

The endpoint-last publication order means a read observes a coherent old pair, a coherent new pair, or a detectable mismatch. This PR does not add automatic mismatch retries; robust retry and recovery policy remain in PR two.

Client failures retain stable, non-secret categories:

- `INVALID_ENDPOINT` for invalid or incompatible discovery metadata.
- `INVALID_CREDENTIAL` for missing, unreadable, or malformed credential metadata.
- `STALE_SERVICE` for mismatched instance IDs.
- `UNAUTHORIZED` for a server-side `401` after coherent discovery.

`service-endpoint.ts` owns record types, typed parsers, identity creation, directory hardening, and secure publication. `local-client.ts` may consume the internal credential parser but never re-exports or returns the parsed token. `main.ts` orchestrates startup and leaves its unrelated general-purpose atomic writer unchanged.

## Authorization diagnostics

Rejected requests are silent by default. Settings gains a persisted, default-off checkbox in a small Diagnostics section named “Log rejected API requests.” Changes apply immediately without restarting the service.

`local-service` emits an optional sanitized authorization-failure callback. `main.ts` checks the live setting and writes stderr output. Authentication never depends on callback or settings availability.

When enabled, one rejection line contains only:

- Request method.
- Pathname without query parameters.
- Coarse reason: `missing`, `malformed`, or `mismatch`.

The service never logs the authorization header, token, token fragment or fingerprint, query parameters, request body, other headers, or remote address. External `401` responses remain identical across all failure reasons.

## First-PR test boundary

Automated tests prove:

- Public health and protocol version 2.
- Mandatory authorization and successful authenticated workflows.
- Missing, malformed, duplicated, and incorrect credentials.
- Denial before every existing non-health route and before unknown-route resolution.
- No unauthorized store operation, callback, body parsing, or state mutation.
- Capability entropy/shape, per-start rotation, record schemas, and instance matching.
- Endpoint-last publication, fatal publication errors, and restrictive POSIX modes, including repair of permissive existing modes.
- Fresh per-request client reads and the four client error categories.
- Default-silent diagnostics, live setting updates, and strict log redaction.
- Existing CLI `open`, `get`, and `edit` behavior through the authenticated shared client.

There are currently no HTTP attachment or deletion routes. This PR does not invent them for testing. Central authentication protects unknown paths by default; the later adversarial PR owns the named attachment/deletion probes and the exhaustive issue-12 matrix.

## Reusable live smoke fixture

The PR adds a development-only TypeScript `smoke:auth` command that targets a running Markover instance and emits one machine-readable JSON result. It creates one clearly labelled review and never deletes or rewrites existing reviews.

The smoke uses two user-controlled phases:

1. `prepare` validates the running service, permissions, record coherence, unauthorized denial, and authorized creation. It writes a temporary `0600` state file containing the review ID, instance ID, and a SHA-256 token digest, never the raw token.
2. After the user restarts Markover, `verify` confirms instance and token rotation, exercises `get` and `edit`, emits the final result, and deletes the temporary state after success.

The visible logging toggle is a short manual supplement because it requires application UI and stderr observation.

Smoke ownership is divided as follows:

- Issue 12 owns protocol-2 development integration, the reusable auth smoke fixture, permissions, instance IDs, rotation, `401` behavior, redaction, and CLI flow.
- Issue 39 owns bounded-loss durability and restart/restoration guarantees.
- Issue 13 reruns only the happy-path protocol/restart scenario against final packaged artifacts and clean Intel hardware, reusing evidence rather than duplicating adversarial or bounded-loss work.

## Documentation and guidance

The implementation updates four durable explanation layers:

- `DECISIONS.md` records the formal protocol, trust boundary, and clean-break policy.
- `AGENTS.md` tells agents that restarts must not require draining inflight reviews, historical JSON must be preserved, and speculative compatibility machinery is forbidden before a real external user base exists.
- `CONTRIBUTING.md` gives human contributors the same compatibility and preservation direction.
- One to three committed self-contained ELI5 HTML pages under `doc/explanations/` explain the complete authorization model, lifecycle, tradeoffs, and explicit non-goals.

Keep the ELI5 compact: prefer one or two pages and never exceed three. Include a flowchart for the service lifecycle and system diagrams that make the trust boundaries visible. If the explanation needs multiple pages, keep them together and give every page a consistent top tab navigation with relative links to its siblings.

Before creating the ELI5, the implementation branch is advanced to the latest `origin/main`, and the repository's `eli5-html-doc` skill is read and followed completely. Final public privacy/data claims remain deferred to the third PR.

## Explicit non-goals

This PR does not add:

- Same-user or privileged-process isolation.
- Mutual server authentication, HMAC challenge/response, or local TLS.
- Stale-port impersonation protection; PR two must resolve it before final security claims.
- Automatic stale-record retries, credential repair, or process replacement.
- Version-1 compatibility or historical-review migrations.
- Windows ACL support.
- Browser clients, CORS, preflight exemptions, or `Host`/`Origin` policy.
- Read/write scopes or per-review credentials.
- Attachment or deletion HTTP APIs.
- Bounded-loss autosave implementation; issue 39 owns it independently.
- Final adversarial verification or public privacy/data documentation.

## Implementation sequence

After explicit confirmation of shared understanding:

1. Fast-forward the empty `agent/launch-api-capability-token` branch to latest `origin/main`, switch this worktree to it, reread repository guidance, and read the complete `eli5-html-doc` skill.
2. Add or revise focused tests for service identity, secure publication, server authorization, client errors/propagation, settings, and CLI behavior.
3. Implement the typed endpoint/credential records, early directory hardening, mandatory server gate, client encapsulation, and Electron startup wiring.
4. Add the live diagnostics setting and sanitized callback.
5. Add the two-phase `smoke:auth` command and automated coverage.
6. Run focused tests, `npm run check`, and the full `npm test` suite.
7. Create the formal guidance updates and compact ELI5 HTML page set, including lifecycle and system-boundary diagrams. Verify every page and cross-page tab through the repository's prescribed local preview path.
8. Commit the tested implementation as the first commit and the guidance/ELI5 as the second commit.
9. Ask for a final go-ahead immediately before restarting the real Markover app, then execute the two-phase live smoke and manual logging check without deleting historical data.
10. Push only `agent/launch-api-capability-token`, open a draft PR against `main`, link issue 12, and update issue 12's stack description. Do not submit empty upper branches.

## Revised issue-12 stack

The issue description will be aligned during PR handoff:

1. Capability generation, protected publication, server authorization, and minimum shared-client propagation.
2. Restart, stale-record, mismatched-pair, stale-port impersonation, and client recovery hardening.
3. Adversarial verification and final privacy/data documentation.

Issue 39 remains an independent Focused Preview blocker for bounded-loss autosave durability. It can proceed in parallel with issue 12.

## Commit and review strategy

The PR contains two cohesive commits:

1. Capability boundary implementation, diagnostics, automated tests, and smoke tooling.
2. Agent/contributor guidance, formal decisions, and the ELI5 explanation.

Only the bottom branch is pushed. The PR opens as a draft and becomes ready only after the ELI5 and implementation handoff are reviewed. No implementation, branch movement, GitHub mutation, or application restart occurs until this plan is reviewed and shared understanding is explicitly confirmed.
