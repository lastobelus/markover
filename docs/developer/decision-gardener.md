# Local decision-register gardener

The decision gardener reconciles landed `main` behavior with `DECISIONS.md`.
It is a trusted maintainer tool, not a GitHub-hosted agent or a general CI
runner. A missed invocation is harmless: every run fetches `origin/main` and
audits the complete range after the durable checkpoint in `DECISIONS.md`.

## Manual invocation

Start from a clean Markover checkout at current `origin/main`, with the local
`gh` and `codex` CLIs already authenticated. The Codex login uses the
maintainer's existing local ChatGPT/Codex subscription; do not provide an
OpenAI API key.

```sh
npm ci
npm --silent run decision-gardener -- --model gpt-5.6-sol
```

The explicit model must be available to the local Codex account. To use a
different available model, replace only the `--model` value. The command fails
before fetching or creating a worktree when the source checkout has tracked or
untracked changes. After fetching, it also refuses to continue unless the
source `HEAD` is the fetched `origin/main`, ensuring that the trusted wrapper
itself is current.

## Trust boundaries

The wrapper performs three separated phases:

1. The trusted host fetches `origin/main` and uses read-only `gh repo view` and
   `gh api` calls to snapshot every open issue and pull request plus trusted
   `start-issue` work-intent comments. The versioned snapshot is bounded and
   becomes immutable agent input. Issue, comment, commit, patch, and file text
   is explicitly treated as untrusted evidence rather than agent instruction.
2. The wrapper creates a detached, clean worktree at the fetched commit and
   runs `codex exec` there. Codex receives the immutable Git bundle and
   ownership snapshot through stdin. It is ephemeral, read-only,
   approval-disabled, shell-disabled, web-disabled, app-disabled,
   subagent-disabled, and isolated from repository instructions and GitHub or
   API-key environment variables. This follows the safety controls available
   in [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
3. Only after the Codex process exits does a separate publisher process regain
   the trusted host environment. It revalidates the result, proposal hashes,
   audited base, clean worktree, and exact one-file diff. It may then commit
   `DECISIONS.md`, push a new `decision-gardener/...` branch, and open a draft
   pull request. It never pushes `main`, merges, closes issues, changes launch
   gates, or creates follow-up issues.

An existing open pull request carrying the decision-gardener publication
marker blocks another run before Codex starts. The publisher repeats that
check immediately before it creates the branch, closing the normal discovery
race on the trusted host.

## Outcomes

The command prints one JSON object:

- `published` includes the draft pull request, publication commit, branch, and
  durable run directory.
- `ambiguous` means the supplied evidence cannot support a safe register
  change. Nothing is committed or pushed; inspect the durable report.
- `no_changes` means no unaudited landed commits remain after recognized
  checkpoint-only publications are excluded.
- `blocked` identifies the unresolved gardener pull request that must be
  reviewed before another proposal is generated.

A complete audit always proposes the full `DECISIONS.md` and advances its one
checkpoint, even when no semantic register entry changes. The publisher
rejects unknown result fields, stale ownership matches, empty classification
evidence, changed unclassified entries, reordered existing entries, a wrong
checkpoint, dirty input, untracked files, or any diff outside
`DECISIONS.md`.

## Durable artifacts and recovery

Runs are stored by default under:

```text
~/Library/Application Support/Markover/Decision Gardener/runs/<run-id>/
```

Each run preserves the ownership snapshot, immutable audit bundle and hashes,
per-round agent results, final structured result, proposed `DECISIONS.md`,
draft pull-request body, publication manifest, outcome or failure record, and
the isolated worktree. These files may contain repository and issue content;
keep the directory private and do not copy local Codex authentication files
into it.

If publication fails after the local commit or push, do not delete or rerun the
artifacts blindly. Inspect `failure.json`, the preserved worktree, the remote
`decision-gardener/...` branch, and any draft pull request. Resolve or remove
that exact partial publication deliberately before starting another run. The
gardener never force-pushes or overwrites an existing branch.

Use `--run-store <absolute-path>` only when the trusted host needs a different
durable private location.

## Trusted Intel-host setup

The optional host controller runs the same manual gardener from a dedicated,
clean checkout on a trusted Intel Mac. It is a user LaunchAgent, not a daemon,
CI worker, or remote agent. Keep that checkout on `main`, keep it current with
`origin/main`, and install dependencies and the build before activation:

```sh
npm ci
npm run build
command -v node git gh codex
```

Create the private config at
`~/Library/Application Support/Markover/Decision Gardener/host-config.json`.
Every executable and PATH directory is explicit because LaunchAgents do not
inherit an interactive shell setup. Do not put tokens, passwords, the Codex
authentication file, or shell fragments in this file.

```json
{
  "auditIntervalMinutes": 60,
  "codex": "/absolute/path/to/codex",
  "environmentPath": [
    "/absolute/directory/containing/node-and-codex",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ],
  "model": "gpt-5.6-sol",
  "notifier": {
    "kind": "notification-center"
  },
  "reasoningEffort": "high",
  "repository": "/absolute/path/to/the/clean/markover-checkout",
  "runStore": "/Users/your-account/Library/Application Support/Markover/Decision Gardener",
  "schemaVersion": 1
}
```

The default notifier uses macOS Notification Center in the current login
session. A genuinely headless host should use a reviewed out-of-band command
instead:

```json
"notifier": {
  "kind": "command",
  "command": ["/absolute/path/to/reviewed-notifier", "fixed-argument"]
}
```

The command is spawned directly, never through a shell. It receives only the
curated process environment plus `MARKOVER_DECISION_GARDENER_EVENT`
(`test`, `failed`, or `recovered`),
`MARKOVER_DECISION_GARDENER_SUMMARY`, and
`MARKOVER_DECISION_GARDENER_RECORD`. Keep the notifier outside the repository
checkout and make it responsible for its own secret storage. The controller
force-kills the notifier process group if it exceeds thirty seconds and treats
that timeout as a delivery failure.

Make the config private, then validate the complete notification route before
installing:

```sh
chmod 600 "$HOME/Library/Application Support/Markover/Decision Gardener/host-config.json"
npm --silent run decision-gardener:host -- test-notifier
npm --silent run decision-gardener:host -- install
npm --silent run decision-gardener:host -- status
```

`install` repeats the notifier test and refuses to write or load the
LaunchAgent if it fails. It first creates the configured run store with private
permissions so notifier preflight has the same working directory as scheduled
delivery. It writes
`~/Library/LaunchAgents/com.lastobelus.markover.decision-gardener.plist`, then
uses `launchctl bootstrap` in the current GUI domain. The plist runs once when
loaded and then asks `launchd` for one lightweight heartbeat every 300 seconds.
It uses `ProcessType=Background`, a private umask, explicit stdout/stderr logs,
and the exact Node, controller, config, run-store working directory, and PATH
values present at installation time. Installation copies a content-addressed
controller payload and its runtime assets to `runStore/controller/<sha256>/`
and points the plist at that immutable private copy. The controller therefore
starts independently of the audited checkout, so a missing checkout is
reported through the ordinary failed-health and notification path.

The `decision-gardener:host` npm script always runs the existing built
controller; it never rebuilds the shared `build/` directory while an audit may
be using it. Build only during initial setup or after unloading the agent for a
deliberate upgrade. Reinstall acquires the host single-flight lock before it
unloads anything and refuses the replacement while an audit is active. If a
reinstall cannot bootstrap the replacement, it restores the previous plist and
reloads the previous agent before reporting the failed upgrade.

Re-run `install` after moving or upgrading Node, moving the checkout, or moving
the built controller. Ordinary cadence changes do not require reinstalling:
edit `auditIntervalMinutes`, validate the file with `status` or
`test-notifier`, and the next heartbeat reads the new value. The minimum is
five minutes and the default is sixty.

## Heartbeats and manual wakeups

The five-minute launchd interval is a correctness wakeup, not the audit
cadence. A heartbeat records itself and exits before Codex when the configured
audit interval is not due. Once due, the existing runner still stops before
Codex when no unaudited commit exists or an unresolved gardener pull request
already owns publication.

Run an immediate, serialized audit without changing the cadence:

```sh
npm --silent run decision-gardener:host -- run-now
```

A trusted local merge hook may invoke that same command as an optimization.
Never make the hook the correctness source: macOS documents that
`StartInterval` firings can be missed while the machine sleeps or while the job
is still running. The next due run fetches `origin/main` and audits the complete
checkpoint-to-tip range, so missed and coalesced wakeups need no replay queue.

The host controller and the audit runner use separate recoverable single-flight
locks. A simultaneous heartbeat or manual wakeup writes a `busy` attempt and
does not disturb the active run. A lock whose recorded process is gone, or
whose PID now belongs to a different process start, is reclaimed atomically.
Each due audit runs in its own process group under a six-hour deadline. If that
deadline expires, the controller force-kills the complete group, records failed
health, releases the host lock, and sends the ordinary failure notification;
durable partial run evidence remains available for recovery.

## Health, logs, and notification recovery

Host state is stored in `host-state.json`. Every invocation creates a private
record under `host-runs/`, including `not_due` and `busy` outcomes, and appends
the same lifecycle facts to `host.log`. Full audit evidence remains under
`runs/<run-id>/`. Launchd stdout and stderr are separate files under `logs/`.
If host state is malformed or unreadable, the cycle emits a failure
notification and preserves the invalid file under a per-attempt
`host-state.invalid.*.json` name before establishing new failed state.

The first successful run establishes healthy state without noise. A transition
to failure sends one `failed` notification; repeated failures retry every
five-minute heartbeat without repeating a successfully delivered notification.
The first later success sends one `recovered` notification. If a failed-event
delivery is still pending when an audit succeeds, that exact failed record is
delivered before the recovery event. Lock-acquisition failures preserve and
retry that same older record before reporting the newer lock failure. If
notification delivery itself fails, the failed health remains pending and the
next heartbeat retries rather than silently marking the host healthy.

For a failure:

1. Run `status` and open the exact record named in the notification or latest
   `host-runs/` entry.
2. Inspect `host.log`, the launchd stderr log, and the referenced full audit
   run. Preserve partial publication artifacts and remote branches.
3. Repair connectivity, checkout freshness, credentials, config, or notifier
   outside the audit worktree.
4. Run `test-notifier` when notification delivery changed, then `run-now`.
   A successful audit records recovery and emits the one recovery transition.

Changing the config while the agent is loaded is safe only when the replacement
is complete, valid JSON. Validate a candidate before replacing the active file;
a malformed active config cannot identify its run store or notifier reliably.

## Disable or move the host

Unload the exact user agent and remove its plist without deleting config,
state, logs, audit evidence, branches, or reviews. Uninstall acquires the host
lock and refuses to unload the controller while an audit is active:

```sh
npm --silent run decision-gardener:host -- uninstall
```

To move the service, uninstall first, update the private config and dedicated
checkout, rebuild, pass `test-notifier`, and install again. Historical run data
is evidence: archive it privately or leave it in place rather than deleting it
as part of routine recovery.
