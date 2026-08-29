# Canonical update control

## Goal

Give the configured canonical Markover app an explicit, user-driven way to discover and install newer commits from its blessed `main` branch. The control sits at the bottom-right of the right pane, uses Lucide `refresh-cw`, matches the pane-toggle treatment, and explains the available pull-request changes on hover and keyboard focus.

## Product behavior

The control is shown only when the running app is the configured canonical development instance. A fixed-height footer keeps it visible below either right-pane tab without overlapping the annotation scroller. Its tooltip reports Current, Checking, Update available, Updating, or a concise recoverable failure; when an update is available it lists the newer merged pull requests from a bounded cached manifest.

Clicking an available update starts one detached update attempt and disables the button. The current app may quit as part of the managed refresh, so the accepted click is not treated as synchronous completion. The replacement app is the completion surface and rechecks status after launch.

## Update authority and safety

The GitHub manifest is display-only. The updater independently proves that it owns the configured canonical checkout, the blessed branch is checked out, the complete worktree is clean, `origin` is the official repository, and the local head can fast-forward to the fetched remote branch. It refuses dirty, divergent, wrong-branch, wrong-origin, noncanonical, or concurrent attempts.

After an exact fetch and fast-forward, the existing managed canonical refresh remains responsible for building before downtime, preserving reviews, replacing or restoring the installed app, relaunching, and checking application identity, build, service, window visibility, and URL routing. If the checkout advances but the build fails, the old app remains intact and the next status explains that refresh is required; a retry is the bounded recovery. A disposable prebuild worktree is excluded because it would duplicate the existing addressed-build and rollback machinery for recoverable state.

## Snappy pull-request changelist

The Pages workflow generates a strict, bounded JSON manifest on every push to `main`. It derives merged pull-request number, title, merge commit, and merge time from GitHub, writes no repository commit, and publishes the file with the existing Pages artifact. The app fetches only that exact allowlisted HTTPS resource in the main process, validates its complete shape and size, stores the last valid copy in owner-only canonical state, and uses that copy immediately on later launches.

The renderer keeps `connect-src 'none'`; it receives only validated status through narrow IPC. A missing, stale, timed-out, or unrecognized manifest makes the changelist unavailable but never blocks or authorizes an update. The public privacy documentation will disclose the automatic bounded GitHub metadata check and local cache.

## Implementation surfaces

- Right-pane footer markup, shared pane icon-button styling, Lucide registration, accessible tooltip, reduced-motion busy animation, and renderer state handling.
- Strict update-status and start-update IPC contracts in the preload/main boundary.
- A detached, single-flight canonical updater built around configured-checkout discovery, guarded Git operations, and the existing refresh command.
- Manifest schema, decoding, cache, changelist selection, and bounded HTTPS retrieval in the main process.
- GitHub Pages manifest generation and focused user/developer privacy documentation.

## Acceptance

- Focused tests prove manifest generation/validation/cache fallback, exact changelist selection, canonical-only visibility, guarded fast-forward refusal cases, single-flight start, IPC validation, footer placement, tooltip accessibility, and unchanged renderer CSP.
- The full local gate passes on the exact PR head.
- Native QA proves the footer remains visible in both right-pane tabs while their content scrolls, hover and keyboard focus show the expected changelist, busy and failure states remain usable, and the control visually matches the pane toggle.
- A real canonical update preserves the selected review, relaunches without activating unexpectedly, and ends with `canonical doctor` healthy at the fetched `main` head.

## Exclusions

This slice does not add background installation, scheduled updates, release-channel downloads, arbitrary Git remotes, non-fast-forward reconciliation, Tailscale changes, update support for PR/dev/smoke/release instances, or trust in cached display metadata for mutation decisions.
