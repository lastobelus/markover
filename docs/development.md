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

Run the repository-owned ESLint and syntax checks plus the test suite before
committing a completed slice:

```sh
npm run check
npm test
```

Editors should use the committed `.editorconfig` settings. `npm run lint` uses
the same committed ESLint configuration as `npm run check` and CI.

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

The local bundle is branded and ad-hoc signed. It is not Developer ID signed or
notarized.

## Build the bootstrap CLI

Build and pack the small CLI separately from Electron:

```sh
npm run build:cli
npm pack ./packages/cli
```

The public launcher downloads the matching macOS application archive and
checksum from the latest GitHub release, verifies the archive, caches the app,
and forwards commands to it.

## Release

The root package and `packages/cli` versions must match. A release tag named
`vX.Y.Z` must also match that version. The GitHub release workflow then:

1. Tests the repository.
2. Packages Markover for Apple Silicon and Intel Macs.
3. Generates SHA-256 checksum files.
4. Packs the bootstrap CLI.
5. Publishes the archives, checksums, and `markover-cli.tgz` on the GitHub
   release.

The project does not currently use Developer ID signing or Apple notarization.

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
