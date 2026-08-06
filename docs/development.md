# Developing Markover

Markover is an Electron app with a dependency-free Node.js bootstrap CLI. The
desktop app owns review storage and the local handoff service; the CLI starts or
contacts that app and keeps agent-facing output machine-readable.

## Requirements

- Node.js 22.13.0 or newer
- npm
- macOS for running and packaging the desktop app

## Local setup

Install dependencies and start the development app:

```sh
npm install
npm start
```

The development command uses the repository checkout directly. Managed reviews
are stored outside the checkout under:

```text
~/Library/Application Support/Markover/reviews/<review-id>/
```

This is also the review store used by packaged builds, so avoid running a
development instance at the same time as the packaged app when working with
important reviews.

## Checks

Run the repository-owned ESLint and TypeScript checks plus the test suite before
committing a completed slice:

```sh
npm run check
npm test
```

Editors should use the committed `.editorconfig` settings. `npm run lint` uses
the same committed ESLint configuration as `npm run check` and CI.

`npm run build` uses the native TypeScript compiler to strictly check maintained
source and emit runnable JavaScript plus source maps under the ignored `build/`
directory. Browser entry points remain plain scripts at runtime, but their
maintained source is TypeScript and no JavaScript migration boundary remains.

The tests cover the Markdown tree, navigation, review sessions and persistence,
the local service and CLI protocol, settings, source-edit proposals, release
artifacts, and the documentation site.

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
finishes bundle metadata and notices before using `@electron/osx-sign` to sign
components inside-out with hardened runtime, no timestamp, and the minimal
checked-in profiles under `config/macos/entitlements/`. The bundle requires
macOS 14 Sonoma or newer. It is **not Apple-verified**: it has no authenticated
Developer ID publisher and is not notarized.

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
