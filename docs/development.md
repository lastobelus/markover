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

CLI cold starts may build the already-configured target checkout, but never
fetch, pull, switch branches, or install dependencies. Development URL bridges
are a separate forwarding-only surface: handler clicks never build or
cold-start an app.

The development command performs a deterministic one-shot build, verifies the
exact staged layout under `build/app/`, and launches Electron from that stage.
Additional command-line arguments and environment variables are forwarded to
Electron unchanged, except `ELECTRON_RUN_AS_NODE` is removed. Paths beneath
`build/app/` are private build details; other development tooling should depend
only on the staging root.

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

PR state is intentionally removed by normal worktree deletion. To make that
cleanup recoverable, first quit the exact instance and use #52's handler
uninstall command for its `markover-N:` scheme, then run from the surviving
worktree:

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

Run the full local pre-PR gate before committing a completed slice:

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
site. Hosted CI runs the live Electron smoke once at the minimum supported Node
version with a 60-second deadline and retains only a small failure-evidence
bundle for seven days.

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

The same kill switch can be enabled with GitHub CLI:

```sh
gh api --method PUT \
  repos/lastobelus/markover/actions/permissions/fork-pr-contributor-approval \
  -f approval_policy=all_external_contributors
```

### Main branch policy

Protect `main` with a repository ruleset that requires pull requests, requires
both Node.js CI jobs to pass against the latest `main`, and requires review
conversations to be resolved. Do not require an approval while Markover has a
single maintainer. Allow emergency bypass only through a pull request so the
change and its CI result remain visible. Use squash merges; disable merge
commits and rebase merges.

## Package the macOS app

Build an application for the current architecture:

```sh
npm run package:mac
open "dist/Markover-darwin-$(node -p process.arch)/Markover.app"
```

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
stable release, point to protected `main`, and already have both required CI
checks. Before tagging, verify the external GitHub safeguards:

```sh
npm run release:preflight -- github-readiness \
  --repository=lastobelus/markover
```

The GitHub release workflow then:

1. Revalidates the tag contract and tests the repository.
2. Builds and verifies both native apps and the matching CLI in unprivileged
   jobs.
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
- Reviews retain the exact Markdown source and SHA-256 checksum.
- Every new review snapshots `review.agentGuidance.fixedContract` and
  `review.agentGuidance.interpretationPolicy`; `get` returns both unchanged.
- Agent-facing instructions must preserve the contract's distinction among
  revisions, questions, discussion, context, and source-edit proposals.

Run the service-free protocol help with:

```sh
npm --silent run markover -- help
```

## Repository map

- `src/` — Electron main process, renderer, review model, and UI assets
- `scripts/` — local launcher, packaging, review, and build scripts
- `packages/cli/` — dependency-free public bootstrap CLI
- `test/` — Node test suite
- `docs/` — GitHub Pages site, user guide, screenshots, and this development
  reference
- `examples/` — sample Markdown documents for parser and UI testing
