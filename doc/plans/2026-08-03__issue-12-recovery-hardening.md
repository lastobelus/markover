# Issue 12: Recovery Hardening PR

Intent: confirmed 2026-08-05

Status: implemented and automatically verified locally; live smoke and GitHub handoff pending.

## Outcome

The second issue-12 pull request makes Markover's protocol-2 client recover predictably from ordinary service-record races, stopped processes, and damaged or mismatched endpoint/token pairs. Before every authenticated request, the client confirms that the listener reports the same non-secret instance ID as the protected records. It sends no capability or review content when that consistency check fails.

A running Markover instance can repair its own discovery records in place after a CLI background-start notification. A stopped instance can be launched normally. Markover is never killed or forcibly replaced by the CLI, and a persistent inconsistency ends with an actionable restart-required error.

This PR deliberately does not add cryptographic server authentication. A malicious local process that deliberately learns an instance ID and later claims a stale port remains outside the implemented protection. The ELI5 and formal decision record must state that limitation without implying that the health identity is authentication.

## Existing foundation

PR #41 established the protocol-2 capability boundary:

- Each process has a fresh UUID instance ID and 256-bit capability.
- `service.json` and `service.token` are fixed sibling records published token-first and endpoint-last.
- The application-data directory is `0700`; both records and their temporary files are `0600` on POSIX systems.
- Every non-health route is gated before routing or body processing.
- Clients read fresh records for every authenticated request and attach the capability internally.
- Missing, malformed, duplicated, and incorrect credentials receive one generic `401` response.
- Graceful shutdown leaves a coherent stale pair; restart rotates both identity values.

The current client detects malformed records and mismatched instance IDs but does not retry publication races. Its public health check proves only that a protocol-2-shaped service responded. The CLI's startup path can launch Markover but cannot ask an already-running primary instance to republish damaged records, and its nominal `replaceStale` option does not actually replace anything.

## Threat and product boundary

The selected security boundary remains the local OS account. Callers that can reach loopback but cannot read the protected capability are denied by the server. Same-user malicious processes and privileged/root processes remain out of scope.

This PR distinguishes ordinary stale-port collisions from deliberate impersonation. A public instance-ID comparison prevents credentials from being sent to an unrelated listener that does not know which Markover instance the protected endpoint names. Because the instance ID is non-secret and observable from health while the real service is running, this check is not cryptographic proof against a process deliberately preparing to impersonate that instance.

The proportional initial-target design therefore excludes challenge-response, same-connection pinning, local TLS, Unix-domain-socket migration, encrypted request bodies, background watchdogs, and new daemon processes. Those mechanisms should be reconsidered only if Markover's real deployment model justifies protection against malicious stale-port takeover.

Issue #39 continues to own bounded-loss autosave durability. Recovery here does not claim that a crash loses no review edits, and the CLI never terminates a process in an attempt to repair authorization state.

## Health consistency contract

Exact `GET /health` remains the only unauthenticated route. Its protocol-2 response becomes:

```json
{"status":"ok","version":2,"instanceId":"<service UUID>"}
```

`startLocalService` receives the full service identity, or equivalently an explicit validated instance ID alongside the capability, so health always reports the identity actually held by that listener.

For a non-health request, the shared client performs these steps:

1. Read and validate `service.json`.
2. Read and validate the fixed sibling `service.token`.
3. Require the two record instance IDs to match.
4. Send an unauthenticated health request containing no capability or review data.
5. Require the health response to have protocol version 2 and the same instance ID.
6. Only after all checks succeed, send the original request with the Bearer capability.

Successful preflight is not cached across requests. Direct health calls validate the response against the endpoint instance ID but do not read the token file.

A missing, malformed, or mismatched health identity is `STALE_SERVICE`. The client sends no authorization header or application request in that case. A coherent, identity-matched service that rejects the capability remains `UNAUTHORIZED`; that response is not silently reclassified as stale.

## Bounded record convergence

The client gives token-first/endpoint-last publication a short, bounded convergence window. Missing, malformed, or mismatched records are reread with small backoff delays because they can be a transient observation of startup or in-place repair.

This record-convergence window is separate from the existing application-startup deadline. It is measured in fractions of a second, has a fixed maximum, and never becomes an indefinite loop. Tests use deterministic timing hooks or small explicit retry options rather than real multi-second waits.

Network failures and invalid health responses do not trigger unbounded record rereads. The higher-level CLI startup path decides whether to notify or launch Markover and then polls for a fully coherent, identity-matched service until its existing bounded startup deadline.

## Startup and in-place repair

`ensureService` changes from health-only probing to complete service probing: coherent endpoint/token records plus matching health identity. Its recovery path is:

1. Return immediately when the complete probe succeeds.
2. Otherwise invoke the existing detached background-start operation once.
3. If Markover is not running, Electron launches the primary instance, which creates a new identity, starts the listener, and publishes a fresh pair.
4. If Markover is already running, Electron's single-instance notification reaches the primary process.
5. A ready primary atomically republishes its current in-memory identity, listener port, and PID using the existing secure publisher.
6. The CLI waits for a complete coherent probe until the startup deadline.
7. If repair never succeeds, return a restart-required error. Do not attempt a second launch mode, kill a PID, delete records, or replace the process.

The primary keeps its current identity and listener during record repair. Repair does not rotate credentials, reload reviews, recreate windows, or restart the service. Concurrent repair notifications are harmless and should be coalesced or serialized with a small in-process promise rather than a generalized task system.

If a notification arrives while the primary is still starting, normal initial publication is sufficient. The notification handler must not publish incomplete identity or listener state.

The endpoint PID remains discovery metadata. It may support diagnostics, but it is not authority, is not used to kill a process, and is not treated as proof of listener identity because PIDs can be stale or reused.

## Request replay boundary

Recovery completes before the application request is transmitted. Once a request may have reached a server, the client does not automatically replay it in this PR.

This matters most for `open`: if Markover created a review but the response was lost, a blind retry could create a duplicate. `get` and `edit` happen to be effectively idempotent today, but the generic transport does not infer operation semantics or apply inconsistent retry rules.

An ambiguous post-send network failure returns an actionable error directing the user to inspect Markover before retrying. A later need for automatic post-send retries should introduce explicit idempotency keys as separately designed work.

The server's existing authorization-before-body rule remains unchanged. A `401` proves Markover did not route or mutate the request, but PR 2 still does not automatically replay it; the caller receives the stable `UNAUTHORIZED` category and restart guidance where appropriate.

## Error and output contract

Existing stable categories remain meaningful:

- `INVALID_ENDPOINT`: endpoint metadata cannot be parsed after bounded convergence.
- `INVALID_CREDENTIAL`: credential metadata cannot be parsed after bounded convergence.
- `STALE_SERVICE`: record IDs or the public health instance ID do not match.
- `UNAUTHORIZED`: an identity-matched service rejects the coherent credential.
- `INVALID_RESPONSE`: health or application JSON violates the expected protocol shape.

The CLI adds or wraps with a stable restart-required category when notification/startup recovery exhausts its deadline. Its message tells the user to quit and reopen Markover, then retry. Errors after ambiguous transmission tell the user to inspect Markover before retrying.

Successful recovery remains invisible to agent callers: stdout is still exactly one JSON result, with no warnings, dialogs, notifications, settings, or progress chatter. Recovery diagnostics must not expose capabilities, token-derived fingerprints, review content, request bodies, or query strings.

## Automated verification boundary

Focused tests prove:

- Health returns protocol 2 plus the actual service instance ID.
- Health still requires no token and reveals no capability, PID, port, or review data.
- Every non-health request performs a fresh record read and health preflight.
- Matching records and health permit the existing authenticated workflows.
- Mismatched record IDs converge when publication completes within the retry window.
- Persistent missing, malformed, and mismatched records preserve stable error categories.
- A health instance mismatch prevents the authorization header, body, and application request from reaching the listener.
- A cold CLI start launches Markover once and waits for a fully coherent service.
- A running primary notification republishes the same identity and capability without restarting.
- Concurrent repair notifications cannot publish an incoherent pair.
- A hung or ineffective primary reaches a bounded restart-required error without process replacement.
- Application requests are not automatically replayed after an ambiguous transport failure.
- Existing `open`, `get`, `edit`, redacted diagnostics, authorization gating, and permission tests remain green.

This is not the exhaustive adversarial matrix. PR 3 continues to own named probes across all routes that exist at that time and the final public privacy/data claims.

## Focused live smoke

The existing `smoke:auth` fixture is extended rather than replaced. Its development-only flow remains machine-readable and preserves historical reviews:

1. Read the current coherent pair and retain only the already-approved non-secret state and token digest handling.
2. Deliberately write a validly shaped mismatched pair while preserving restrictive file modes.
3. Trigger the normal CLI recovery signal.
4. Confirm the running primary repairs the pair with the same instance ID and same token digest, proving no restart or rotation occurred.
5. Run the existing `prepare` checks and create one clearly labelled smoke review.
6. Stop for the user-controlled Markover restart.
7. Run `verify` to prove instance and capability rotation plus authenticated `get/edit`.

If the smoke process stops while the pair is mismatched, the normal recovery path can repair it; the fixture does not delete historical reviews or credentials. Before the real smoke mutates records or restarts Markover, the implementation thread asks the user for an explicit go-ahead so they can warn other agents or allow an active CLI request to finish.

The smoke does not measure autosave loss, crash the app, drain inflight reviews, exercise packaged artifacts, or duplicate issue #13's release-artifact evidence.

## Documentation

`DECISIONS.md` is updated to record:

- Public instance-ID health consistency checking.
- Fresh per-request preflight.
- Bounded record convergence and in-place primary repair.
- No forced process replacement or ambiguous request replay.
- The explicit distinction between ordinary stale-port detection and malicious impersonation.

The existing self-contained `doc/explanations/2026-08-03__local-api-authorization-eli5.html` becomes the approachable explanation of the complete current authorization and recovery system. It includes diagrams for startup/publication, per-request validation, in-place repair, cold start, restart-required failure, and the trust boundary. It states plainly that the instance ID is a name tag, not cryptographic proof.

The ELI5 remains compact and avoids speculative future architecture. The repository's `eli5-html-doc` skill is read completely immediately before editing it, and the result is verified through the prescribed static and browser checks.

Issue #12's stack wording is updated during GitHub handoff so PR 2 claims ordinary stale-port consistency checking rather than malicious stale-port impersonation protection. Final privacy/data documentation remains PR 3 work.

## Explicit non-goals

This PR does not add:

- Protection from malicious same-user, privileged, or root processes.
- Cryptographic stale-port server authentication.
- HMAC challenge-response or TCP connection pinning.
- Local TLS, certificates, Unix-domain sockets, CORS, or browser-client support.
- Forced process termination, PID-based replacement, or automatic application restart.
- Automatic replay after ambiguous request transmission.
- Idempotency keys or client-generated review IDs.
- New settings, dialogs, notifications, watchdogs, daemons, or dependencies.
- Protocol-1 compatibility, migrations, dual readers, or dual writers.
- Historical-review rewrites or deletion.
- Bounded-loss autosave durability from issue #39.
- Packaged release smoke from issue #13.
- PR 3's adversarial matrix or final public privacy/data claims.

## Implementation sequence

After explicit confirmation of shared understanding:

1. Advance the unpublished `agent/launch-api-client-auth` scaffold to merged `origin/main`, switch this worktree to it, and leave the temporary clean recovery branch unpublished.
2. Add focused tests for health identity, per-request preflight, bounded convergence, no-secret mismatch behavior, CLI cold start, in-place repair, bounded failure, concurrency, and replay prohibition.
3. Extend `local-service` to report its validated instance ID from health.
4. Refactor `local-client` around a bounded coherent-connection resolver and preflight every authenticated request before constructing or sending its application request.
5. Replace the CLI's ineffective replacement attempt with one launch-or-notify operation and complete-probe waiting.
6. Retain the current service identity/listener state in `main`, and handle background-server single-instance notifications by securely republishing the current pair when ready.
7. Extend the existing auth smoke with the minimal in-place repair check.
8. Run focused tests, `npm run check`, and the complete `npm test` suite.
9. Update `DECISIONS.md`, this plan as necessary, and the existing authorization ELI5; verify the ELI5 statically and through the prescribed browser path.
10. Commit one tested implementation commit and one decision-record/ELI5 documentation commit.
11. Ask for explicit approval before altering live service records or restarting Markover, then run the focused recovery/restart smoke.
12. Push only `agent/launch-api-client-auth`, open a draft PR against `main`, link issue #12, and update the issue stack wording. Do not publish the third scaffold branch.

## Delivery and review strategy

The pull request contains two cohesive commits:

1. Recovery implementation, deterministic automated tests, and focused smoke extension.
2. Formal decision record, standalone plan, and updated complete-system ELI5.

The PR opens as a draft. It becomes ready only after automated checks, the approved live smoke, and review of the updated ELI5 and implementation handoff. The third issue-12 branch remains unpublished until it contains its real adversarial-verification work.

The no-note Markover review was approved on 2026-08-05. Implementation proceeded on the unpublished `agent/launch-api-client-auth` branch; live service-record mutation and restart remain separately gated immediately before the focused smoke.
