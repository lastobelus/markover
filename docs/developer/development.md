# Developing Markover

Markover is an Electron app with a dependency-free Node.js bootstrap CLI. The
desktop app owns review storage and the local handoff service; the CLI starts or
contacts that app and keeps agent-facing output machine-readable.

## Requirements

- Node.js 22.13.0 or newer
- npm
- macOS for running and packaging the desktop app

## Local instances and setup

Markover development uses one canonical instance and any number of isolated PR
instances. Configure the checkout and currently checked-out branch that should
own canonical cold starts once from `main` (or another intentionally blessed
branch):

```sh
npm ci
npm run setup:canonical -- main
npm start
```

The descriptor is private user state under macOS Application Support. Canonical
launches validate that its exact checkout still exists and still has the
blessed branch checked out; they do not scan worktrees, switch branches, pull,
or install dependencies. Unqualified `npm start` selects canonical only from
that configured checkout.

T3 worktrees have an automatic **Setup Worktree** action. It runs `npm ci` and
copies `config/development.defaults.json` to the ignored, worktree-local
`.markover/development.json` only when the destination does not already exist.
Run the same setup manually outside T3 with:

```sh
./scripts/setup-worktree.sh
npm start
```

From a PR worktree, an unqualified start infers the current open pull request
and launches `Markover-N`; `npm start -- --instance dev` makes that selection
explicit. A stopped PR instance requires a live `gh pr view` result proving the
PR remains open. An already-running instance remains addressable if that check
is temporarily unavailable or the PR has since closed, but a closed or merged
PR cannot cold-start.

The same local-only targeting applies to the CLI:

```sh
# Canonical, from any checkout
npm --silent run markover -- open plan.md --summary "Review this plan"

# Current PR worktree only; there is no machine-wide PR registry
npm --silent run markover -- --instance dev open plan.md --summary "Review this plan"
```

`open` returns `reviewUrl` with the instance it actually targeted: canonical
commands emit `markover:` and PR commands emit `markover-N:`. Present that URL
as a best-effort Markdown link, retain the accompanying raw review ID for `get`
and `edit`, and put `open '<reviewUrl>'` alone on its own line as the reliable
Terminal handoff. T3 Code and Codex do not currently dispatch these
custom-scheme Markdown links.

CLI cold starts may build the already-configured target checkout, but never
fetch, pull, switch branches, or install dependencies. Development URL bridges
are a separate forwarding-only surface: handler clicks never build or
cold-start an app.

Inspect or refresh canonical development state from any checkout:

```sh
npm --silent run markover -- canonical doctor
npm --silent run markover -- canonical refresh
# Leave /Applications untouched for this refresh:
npm --silent run markover -- canonical refresh --no-install
```

`doctor` is read-only and reports one JSON value covering the configured
checkout and HEAD, running service identity, Electron window visibility,
startup build identity, exact running executable and bundle identifier, and
exact LaunchServices owner for `markover:`. It exits nonzero when checkout,
application identity, build, service, or routing is unhealthy.

`refresh` builds and verifies one addressed canonical bundle before downtime,
then asks the running canonical app to quit through its managed durability
barrier. By default it stages and atomically replaces
`/Applications/Markover.app`, keeps the prior app until doctor succeeds, and
launches the exact installed executable. `--no-install` leaves `/Applications`
untouched and launches the same build from its owned
`.markover/generated/canonical` path. A failed build or staged-copy verification
changes neither the running app nor `/Applications`; a failed post-replacement
health check restores the prior app. Both modes order the replacement window
visible without activating Markover, explicitly replace the canonical
development handler, and return only after `doctor` proves the selected
executable, bundle identity, build commit, service, `electron-visible` window,
and routing.

Neither command fetches, pulls, switches branches, installs dependencies, or
derives canonical identity from the caller's worktree. `electron-visible` reports
`BrowserWindow.isVisible()`; it does not prove the window is onscreen in the
active macOS Space. Automatic CLI cold starts remain hidden.

Canonical review creation checks this exact URI ownership after the service is
ready and before it creates the review. A displaced or missing handler fails
with the `canonical refresh` recovery command instead of returning a broken
`reviewUrl`. A canonical repair is complete when `doctor` is healthy with an
`electron-visible` window and an exact known `markover://review/<review-id>` URI
selects that review. Window visibility alone and manual selection remain
insufficient routing evidence.

When canonical startup or activation behavior changes, begin native recovery
QA with another app frontmost and full-screen. After refresh, confirm Markover
has not activated and has no window in the active Space. Then select Markover
through Cmd-Tab and confirm its main window becomes focused and onscreen. Repeat
from a fresh refresh and invoke **Window → Bring All to Front**; it must produce
the same focused, onscreen result. Electron visibility is setup evidence, not
the completion signal for this QA.

When manually launching a packaged build for QA, set
`MARKOVER_SUPPRESS_PROTOCOL_REGISTRATION=1` so the app skips its explicit claim
and does not consume the recorded first ordinary launch attempt. Launch the
bundle executable directly when the canonical development handler must retain
`markover:`: asking LaunchServices to open the QA bundle can register its plist
independently of the app-level suppression. Link-handler QA must inspect and
restore the exact prior owner after an explicit LaunchServices exercise.

`npm start` performs a deterministic one-shot build, verifies the exact staged
layout under `build/app/`, builds the selected instance's addressed application
bundle, and launches that bundle's exact executable. Additional command-line
arguments and environment variables are forwarded unchanged, except
`ELECTRON_RUN_AS_NODE` is removed. Paths beneath `build/app/` are private build
details; development launchers consume the verified addressed bundle instead.

For repeated visual or interaction QA, keep the addressed instance on the
development loop instead:

```sh
# Infer canonical or the current pull-request instance from this checkout
npm run dev

# Require the current pull-request instance
npm run dev -- --instance dev
```

The loop performs one complete build and addressed-bundle preparation when it
starts. If the selected instance is already running under this live loop, the
new watcher attaches to it; an older non-live instance is replaced once so it
can load the development renderer safely.

### Resumable development startup

Agents prepare a pull-request instance through the saved **Start Dev Build**
Project Action. The checked-in definition runs the dependency-light
`scripts/markover-start-dev-build.js` entrypoint, so setup or compilation can
fail before the application build exists and still return one classified
result. Agents list the saved actions, launch the unique eligible result, end
their turn, and validate the resumed summary before continuing. A missing or
disabled saved action is reported before falling back to the direct `npm run
dev -- --instance dev` loop.

The launcher owns only setup, build, startup, and readiness. It binds the run
to the exact Git head and addressed instance, preserves a bounded diagnostic
tail, and wakes with `build-failed`, `startup-failed`, `port-conflict`,
`process-exited`, or `timed-out` when intervention is useful. Mechanical
success includes the watcher PID, app PID, health URL, service instance ID, and
an explicit startup-ready signal. The importable QA action returns
`awaiting-human`: the machine is ready, while visual behavior remains
unaccepted until the user checks it. A direct readiness-only invocation may
return `ready`; that outcome also makes no visual claim.

The watcher publishes its current machine-readable receipt under
`.markover/generated/<instance>/development-watch.json`. A later action run can
adopt the same exact-head watcher instead of creating a duplicate. A live
watcher or app with mismatched ownership returns `port-conflict` and is left
running for the agent to interpret. A fresh action may launch dirty development
work, but it will not adopt an already-running watcher for a dirty checkout
whose exact contents cannot be proven by the receipt.

After that startup, CSS, HTML, renderer, preload, and renderer-only dependency
edits build into a separate worktree-local renderer directory. The directory is
published only after every asset succeeds, then the existing Electron process
reloads the existing `BrowserWindow`. The native window is never closed or
recreated, so its size, position, visibility, and focus remain unchanged. A
failed renderer build leaves the displayed renderer and last published assets
untouched, and the next valid edit retries normally.

An edit used by Electron's main process or local backend prints the message
`restart required` and leaves the running window untouched. Stop and restart
the loop when that change should enter the application; the loop never turns a
runtime edit into an automatic app restart. Its receipt remains
`restart-required`, and `Start Dev Build` reports `startup-failed` rather than
presenting the stale running binary as ready. Watcher implementation updates hand
the running app to the replacement watcher without quitting it. Generated
output, dependency directories, Git metadata, and instance state do not trigger
rebuilds. Keep only one loop per instance and use `npm start` for deterministic
one-shot work. End the loop with Ctrl-C; it asks the addressed instance to quit
through the managed durability path and waits for that process before
returning.

### Shared development element callouts

While the live development loop is running, Option-click a rendered element
whose path from its nearest unique ID is at most 128 elements. Markover pins a
bright bounding box to that element and copies one opaque `mko-ui-v1:`
reference to the clipboard. Deeper targets report that they cannot be
referenced and copy nothing. Paste a copied reference into the agent thread; no
screenshot, DevTools inspection, or hand-drawn circle is needed.

An agent highlights the same element in the addressed running instance with:

```sh
npm --silent run markover -- --instance dev element highlight '<mko-ui-v1-reference>'
```

Clear the pinned box with:

```sh
npm --silent run markover -- --instance dev element clear
```

Omit `--instance dev`, or pass `--instance canonical`, when `npm run dev`
addresses the canonical checkout instead of a pull-request worktree. Element
commands address only an already-running watcher and never cold-start Markover.

References use a validated unique-ID anchor and deterministic same-tag child
indices, sibling counts, and structural fingerprints.
Stale or ambiguous references fail instead of selecting a different element.
The picker and authenticated highlight route exist only in a running live
development watcher; release and non-watch instances do not expose them.

## Development review links

Install or inspect the forwarding-only handler for the current worktree's open
PR with:

```sh
npm --silent run link-handler -- --instance dev install
npm --silent run link-handler -- --instance dev status
```

Use `--instance canonical` for the canonical development handler. Installation
is idempotent for the same exact binding. `repair` rebuilds and reregisters that
binding; `replace` is the explicit conflict-accepting operation after inspecting
the reported owner. Routine starts never change handler ownership.

The bridge forwards only to the selected instance's already-running,
authenticated local service. It never builds, launches, searches worktrees,
or contacts GitHub. If the instance is stopped, its one-button native modal
tells the developer to return to the owning thread, start or fix the build, and
open the link again. Terminal.app and iTerm2 may not linkify the custom scheme;
pasting `open '<reviewUrl>'` is verified to dispatch it through macOS.

Remove a handler by exact scheme, including after its worktree has disappeared:

```sh
npm --silent run link-handler -- status markover-N
npm --silent run link-handler -- remove markover-N
```

Removal unregisters and deletes only the expected generated app under
`~/Library/Application Support/Markover/Development/Link Handlers/`; review
state is unchanged. A conflicting owner requires explicit `--force`, which
still removes only Markover's expected generated app and does not alter the
other owner.

Canonical managed reviews are stored outside the checkout under:

```text
~/Library/Application Support/Markover/reviews/<review-id>/
```

Each PR instance instead uses `.markover/instance` as its complete Electron
user-data and service boundary. Its settings, reviews, singleton lock, service
endpoint, and credentials cannot collide with canonical or another worktree.
Generated watermarked icons are cached under `.markover/generated`, and the
ignored development configuration initially selects Ocean with dark
appearance. Persisted settings inside that instance may override those initial
defaults.

### Autosave durability setting

Managed reviews use a two-second maximum-loss window by default while the app
process is responsive and local storage is healthy. The coordinator reserves
up to 500 milliseconds, or half of a shorter configured window, for the flushed
replacement write. With the default it starts sustained-edit writes at most
1.5 seconds apart. Advanced users can change `autosaveMaximumDelayMs` in the
instance's persisted `settings.json` to an integer from `100` through `60000`
milliseconds. The setting is intentionally absent from the Settings UI. Quit
Markover before editing the file and restart it afterward; changing the value
changes both the write interval and the stated maximum-loss window.

A persistent in-app autosave warning means a write failed or exceeded its
reserved persistence budget, and the normal bound is suspended. Markover
retains the newest snapshot and retries failures with bounded backoff. Normal
quit snapshots every editable review, waits for attachment and review
persistence, then closes the service. If that barrier cannot finish in five
seconds, Markover offers Retry Quit, Cancel Quit, or Quit Anyway. The
bounded-loss claim covers an app-process crash, not power loss, unhealthy or
unusually slow storage, or operating-system or hardware failure.

PR state is intentionally removed by normal worktree deletion. To make that
cleanup recoverable, first quit the exact instance, run
`npm --silent run link-handler -- remove markover-N`, then run from the
surviving worktree:

```sh
npm --silent run markover -- --instance dev cleanup pr-N
```

Cleanup refuses canonical state, a different PR identity, a running process,
an installed handler, symlinked state, or anything outside the exact
worktree-local root. It moves `.markover/instance` to a collision-safe location
in macOS Trash and prints that recovery path as JSON. It is never automatic;
removing only the handler preserves all instance state.

The shared `ResolvedInstance` contract consumed by development protocol
handlers contains identity, scheme, state and service roots, endpoint and
credential paths, checkout, process status, PR state, cold-start eligibility,
and branding. Consumers must not reconstruct paths or infer identities. A
running process takes precedence only within the addressed identity:
`markover:` is canonical and `markover-N:` is PR N.

## Checks

After focused checks pass, commit the completed slice so the evidence can bind
to a clean exact head. Agents run the full local pre-PR gate through the saved
resumable **Run Local CI** Project Action; humans can run the same gate directly:

```sh
npm run ci:local
```

It performs one clean build followed by lint, type checking, notice validation,
the compiled Node tests, and a hidden Electron renderer smoke against that same
stage. The local smoke has a strict 10-second deadline so a fixable startup
regression is caught before it can consume hosted CI time.

Focused commands remain available:

```sh
npm run check
npm test
npm run smoke
```

Editors should use the committed `.editorconfig` settings. `npm run lint` uses
the same committed ESLint configuration as `npm run check` and CI.

`npm run build` uses the native TypeScript compiler for Node-side code and
esbuild for one unminified, non-split ESM renderer bundle with an external
source map. It emits the sole runnable application root at `build/app/` and
rejects missing, extra, symlinked, or runtime dependency files before
succeeding. The renderer resolves no package from `node_modules` at runtime.

Development startup reports stable phases in the startup screen, stderr, and a
sanitized diagnostic. Reproduce a fixed failure or hold with:

```sh
npm start -- --dev-fail-startup=restoring-workspace
npm start -- --dev-hold-startup=publishing-service
```

Accepted phases are `preparing-interface`, `loading-settings`, `loading-brand`,
`restoring-reviews`, `restoring-workspace`, `publishing-service`, and `ready`.
These controls are rejected for packaged applications and disabled in smoke.

The tests cover the Markdown tree, navigation, review sessions and persistence,
the local service and CLI protocol, settings, startup/readiness, the staged
application, source-edit proposals, release artifacts, and the documentation
site. Ordinary hosted CI runs static checks, tests, and the live Electron smoke
on Node 24. The live smoke has a 60-second deadline and retains only a small
failure-evidence bundle for seven days. The tag-triggered release workflow
reruns the checks on the minimum supported Node 22.13.0 and owns packaged smoke
before assembling a release candidate.

Node's test runner retains its default test-file concurrency. Keep it enabled
unless profiling demonstrates that a different setting improves the complete
local gate.

### GitHub Actions cost controls

Pull requests run the required checks on GitHub-hosted runners. The repository
currently requires workflow approval from first-time external contributors. If
external pull requests begin consuming too many Actions minutes, change
**Settings → Actions → General → Approval for running fork pull request
workflows from contributors** to **Require approval for all external
contributors**. This keeps the pull requests open while preventing their
workflows from consuming runner minutes until a maintainer approves them.

Routine pull requests and `main` pushes do not build native macOS packages or
run the packaged happy-path smoke. That evidence belongs to the `v*`
tag-triggered release-candidate workflow, where it qualifies the exact final
Apple Silicon ZIP. Native Intel release qualification remains deferred to issue
#80.

The same kill switch can be enabled with GitHub CLI:

```sh
gh api --method PUT \
  repos/lastobelus/markover/actions/permissions/fork-pr-contributor-approval \
  -f approval_policy=all_external_contributors
```

### Main branch policy

Protect `main` with a repository ruleset that requires pull requests, requires
the Node 24 verification check to pass against the latest `main`, and requires review
conversations to be resolved. Do not require an approval while Markover has a
single maintainer. Allow emergency bypass only through a pull request so the
change and its CI result remain visible. Use squash merges; disable merge
commits and rebase merges.

## Package the macOS app

Build an application for the current architecture:

```sh
npm run package:mac
MARKOVER_SUPPRESS_PROTOCOL_REGISTRATION=1 \
  "dist/Markover-darwin-$(node -p process.arch)/Markover.app/Contents/MacOS/Markover"
```

Launching the bundle executable directly keeps LaunchServices from discovering
the QA bundle's declared `markover:` scheme. If a test intentionally exercises
LaunchServices with the package, capture the prior owner first and finish by
running `canonical refresh` to restore and verify canonical routing.

The package command selects an explicit, fail-closed `ad-hoc` trust mode. It
extracts the final ASAR and verifies it against the same exact staged-layout
contract, finishes bundle metadata and notices, then uses `@electron/osx-sign`
to sign components inside-out with hardened runtime, no timestamp, and the
minimal checked-in profiles under `config/macos/entitlements/`. Finally it runs
the hidden renderer smoke against the signed executable with a 60-second
deadline. The bundle requires macOS 14 Sonoma or newer. It is **not
Apple-verified**: it has no authenticated Developer ID publisher and is not
notarized.

Because ad-hoc signatures have no shared Team ID, the hardened Electron app and
helper processes use `com.apple.security.cs.disable-library-validation` so they
can load the separately signed Electron framework. Frameworks and other
embedded code do not receive that exception, and final-artifact verification
enforces the exact placement. A future Developer ID build should remove the
exception once every component shares the authenticated Team ID.

To exercise the exact final-ZIP preflight in a verification-only directory:

```sh
architecture="$(node -p process.arch)"
version="$(node -p "require('./package.json').version")"
release_directory="$(mktemp -d)"
ditto -c -k --sequesterRsrc --keepParent \
  "dist/Markover-darwin-${architecture}/Markover.app" \
  "${release_directory}/Markover-darwin-${architecture}.zip"
(
  cd "${release_directory}"
  shasum -a 256 "Markover-darwin-${architecture}.zip" \
    > "Markover-darwin-${architecture}.zip.sha256"
)
npm run release:preflight -- verify-macos \
  "--archive=${release_directory}/Markover-darwin-${architecture}.zip" \
  "--checksum=${release_directory}/Markover-darwin-${architecture}.zip.sha256" \
  "--architecture=${architecture}" \
  "--version=${version}" \
  "--trust-mode=ad-hoc"
```

The verifier checks safe extraction, IDs, version, architecture, the Sonoma
floor, strict code seals, hardened-runtime flags, exact per-component
entitlements, the absent Team ID, and expected Gatekeeper rejection. A
successful `spctl` assessment would be unexpected in ad-hoc mode.

## Build the bootstrap CLI

Build and pack the small CLI separately from Electron:

```sh
npm run build:cli
npm pack ./packages/cli
```

The public launcher downloads the matching macOS application archive and
checksum from the latest GitHub release. On first installation of a version, it
checks the digest, bundle ID, version, architecture, Sonoma floor, strict code
seal, hardened runtime, and expected ad-hoc signature while the app is still in
staging. Only then does it atomically cache the app with an internal validation
marker and print a `not Apple-verified` warning to stderr. Cached versions with
the matching marker skip the full installation check, and successful agent
commands preserve JSON-only stdout.

## Release

The root package and `packages/cli` versions must match. A stable release tag
named `vX.Y.Z` must match that version, be strictly newer than the preceding
stable release, point to protected `main`, and already have the required Node
24 CI check. Before tagging, verify the external GitHub safeguards:

```sh
npm run release:preflight -- github-readiness \
  --repository=lastobelus/markover
```

The GitHub release workflow then:

1. Revalidates the tag contract and tests the release candidate on the minimum
   supported Node 22.13.0.
2. Builds and verifies the native Apple Silicon app and matching CLI in
   unprivileged jobs. Native Intel release activation is deferred to issue #80.
3. Independently rehashes the complete payload set and generates GitHub
   build-provenance attestations.
4. Creates a complete draft with generated provenance and rollback notes.
5. Waits for approval at the protected `release` environment.
6. Downloads the draft assets by release ID, proves their bytes and metadata
   are unchanged, verifies their attestations, and publishes without another
   upload.

The project does not currently have the Apple Developer Program access required
for Developer ID signing and notarization. Activation is a future reviewed
change; credentials alone must never switch the trust mode or silently fall
back to ad-hoc signing. `developer-id-readiness` therefore reports an intentional
nonzero `blocked` state today.

Follow the canonical [release, rollback, and withdrawal runbook](./releasing.md)
for one-time repository settings, clean-machine approval, verification,
version-pinned rollback, and future Developer ID activation.

## Agent protocol conventions

- Successful CLI commands write exactly one JSON value to stdout.
- Usage help and failures go to stderr and use a non-zero exit status when
  appropriate.
- `open`, `get`, and `edit` must not steal focus from the user's current app.
- `open` returns promptly with an opaque review ID; it does not wait or poll.
- `get` freezes and returns one review snapshot. Repeating it is idempotent.
- `get-for-review` freezes one pristine review in `agent-reviewing`, snapshots
  the global permission and reviewer provenance, and returns the complete v1
  artifact. Repeating it with only the review ID is a recovery read.
- `submit` accepts that complete artifact atomically. It changes only feedback
  and mode-authorized source proposals, transitions to `reviewed`, and is
  exactly retryable after an uncertain response.
- `pending` returns metadata for every unresolved review opened by the exact
  current requesting thread. It does not activate, freeze, or expose review
  content.
- `resolve` records reviewed-with-no-notes or accepted-unreviewed. Existing
  feedback requires the shared Markover summary and explicit Abandon feedback
  confirmation; `unresolve` returns a reversible manual outcome to Editing.
- Before merge or final thread completion, agents treat a nonempty `pending`
  result as a soft gate and ask the user for an explicit disposition.
- Reviews retain the exact Markdown source and SHA-256 checksum.
- Every new review snapshots `review.agentGuidance.fixedContract` and
  `review.agentGuidance.interpretationPolicy`; `get` returns both unchanged.
- Reviewer agents instead follow the dedicated
  `review.agentReviewer.agentGuidance` contract returned by `get-for-review`.
- Agent-facing instructions must preserve the contract's distinction among
  revisions, questions, discussion, context, and source-edit proposals,
  including substantive engagement with discussion and concerns.

Run the service-free protocol help with:

```sh
npm --silent run markover -- help
```

## Repository map

- `src/` — Electron main process, renderer, review model, and UI assets
- `scripts/` — local launcher, packaging, review, and build scripts
- `packages/cli/` — dependency-free public bootstrap CLI
- `test/` — Node test suite
- `docs/user/` — source for the deployed GitHub Pages site and user guidance
- `docs/developer/` — contributor setup, architecture, security, testing, and
  maintenance references
- `examples/` — sample Markdown documents for parser and UI testing
