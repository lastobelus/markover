# App Sandbox feasibility for direct-download releases

## Recommendation: defer

Do not enable Apple's App Sandbox in the current direct-download release.
Reconsider it only after Developer ID activation supplies a stable Team ID and
the app-to-CLI discovery contract has a signed, sandbox-compatible replacement.

This is a **defer**, not a rejection. App Sandbox would materially reduce the
filesystem, process, and network authority available to a compromised Electron
main process. The current architecture, however, depends on exactly those
ambient authorities for its core local workflow. Enabling the entitlement now
would either break that workflow or require broad temporary exceptions that
would erase much of the intended protection.

Issue [#44](https://github.com/lastobelus/markover/issues/44) owns this bounded
feasibility spike. It does not change production entitlements, release
packaging, or shipped behavior.

## Prototype result

The checked-in `npm run spike:app-sandbox` command builds a separate Electron
MAS runtime, assigns the spike-only bundle ID
`com.lastobelus.markover.sandbox-spike`, removes Markover's production URL
scheme, applies the minimal provisional entitlement profiles under
`config/macos/app-sandbox-spike/`, ad-hoc signs the complete bundle, verifies
its nested signatures and entitlements, and launches only the hidden smoke
path. It writes sanitized JSON evidence to
`tmp/app-sandbox-spike/evidence.json`.

The physical 2019 Intel Mac on macOS 14.8.9 produced this finite result:

| Check | Result |
| --- | --- |
| Electron runtime | MAS-capable Electron 43.2.0 package built for x64 |
| Code signature | Complete nested ad-hoc signature verified |
| App Sandbox entitlement | Present on the main app and inherited by children |
| Minimal file/network grants | User-selected read-only files, app-scoped bookmarks, network client, and network server |
| Production entitlements | Unchanged |
| Runtime | Blocked before Markover application code |
| Reproducible blocker | Electron's MAS process rendezvous was denied because an ad-hoc signature has no shared Apple Team ID application group |

The path-limited `App Sandbox spike` pull-request job runs the same probe on a
GitHub-hosted Apple Silicon macOS 15 runner and retains only the sanitized JSON
artifact. That job is not part of routine macOS CI; it runs when the spike
workflow, probe, entitlements, or focused test changes, and remains manually
rerunnable after this decision lands.

The prototype deliberately stops at this blocker. The first launch needed the
same ad-hoc-only library-validation and JIT exceptions already understood by
the current packaging boundary. Adding speculative application-group or Mach
service exceptions without a real Team ID would turn the spike into an
exception ladder and would not demonstrate a viable direct-download design.

## Capability inventory

| Required workflow | Current authority | Smallest sandbox mechanism | Result / cost |
| --- | --- | --- | --- |
| Open arbitrary Markdown | Native open panel followed by direct `fs.readFile` | `files.user-selected.read-only` | Initial read is viable through Powerbox. |
| Restore source context | Persisted absolute source path; rereads source after restart | App-scoped security bookmark per source | Review schema/private storage must retain and refresh a bookmark, bracket every access, and handle revoked/stale grants. |
| Discover Git project context | Runs `git` and traverses the repository around the selected file | User-selected repository folder plus bookmark, or remove/degrade discovery | Selecting one Markdown file does not authorize its repository, `.git`, remote metadata, or favicon candidates. |
| Persist reviews, attachments, settings, workspace | Shared `~/Library/Application Support/Markover` tree | App container plus a one-time container migration manifest | The app can migrate, but the standalone CLI loses its shared filesystem rendezvous. |
| CLI `open/get/edit/revise` | CLI reads endpoint/token files from shared Application Support, then connects to ephemeral loopback HTTP | Signed broker or helper plus a Team-ID application group; network server/client grants | Core workflow needs a new discovery/ownership architecture. Broad home-relative exceptions are not an acceptable substitute. |
| Loopback service | Main process listens on ephemeral `127.0.0.1`; optional gateway also connects locally | `network.server` and `network.client` | Socket initiation is viable once discovery and credentials are redesigned. |
| Screenshot attachments | DOM clipboard or Electron clipboard; image bytes saved in review storage | Container storage; no extra file entitlement expected | Likely viable after startup, but packaged runtime validation remains blocked by Team identity. |
| Local image preview | Allowlisted attachment path served through `markover-app:` and `net.fetch(file:)` | Container storage and existing protocol allowlist | Likely viable for container-owned attachments; must be re-proved in a signed runtime. |
| Clipboard text/image | Electron clipboard APIs | No documented App Sandbox entitlement | Likely viable; must be re-proved in a signed runtime. |
| External public links | `shell.openExternal` | System-mediated open | Likely viable; production `markover:` registration was removed from the spike to avoid changing routing. |
| Metadata enrichment | Reads `.codex`, `.claude`, and T3 state; may spawn `codex` | Separate user-selected grants and executable/broker design, or remove/degrade enrichment | Ambient discovery is incompatible with a minimal sandbox. |
| Canonical maintenance | Spawns `git`, `gh`, `lsregister`, and native tooling; writes shared descriptors | Outside-sandbox broker or redesigned signed helper | Current repair and cold-start architecture is incompatible. |
| Development instances | Write state under arbitrary checkouts | Keep development bundles unsandboxed | This spike applies only to packaged release feasibility. |
| Update/cache/rollback | Bootstrap CLI owns download cache; app owns persistent review data | Keep updater outside app; migrate app data into container before first sandboxed launch | Rollback to an unsandboxed version needs a preserved pre-migration copy and an explicit restore procedure. |

## Security benefit

App Sandbox adds a boundary that hardened runtime and Chromium renderer
sandboxing do not provide: it constrains the Electron main process and helper
processes after compromise. With a genuinely minimal profile, an attacker
would be unable to enumerate arbitrary home-directory data, launch arbitrary
tools, or initiate undeclared network activity. Access would be limited to the
app container, resources the user explicitly selected, and declared loopback
connections.

That benefit remains meaningful even though Markover already uses a sandboxed,
capability-minimal renderer. The renderer boundary limits how untrusted UI
content reaches privileged code; App Sandbox limits what that privileged code
can do if it is compromised.

The benefit falls sharply if Markover grants temporary home-directory,
executable, Mach, or metadata exceptions merely to preserve the existing
architecture. The recommendation therefore rejects an exception-heavy
"compatible" sandbox profile.

## Required architecture before adoption

1. Package the direct-download app with Electron's MAS runtime and Developer ID
   signing while preserving the existing ASAR, fuse, hardened-runtime, and
   final-artifact checks.
2. Establish a signed Team-ID boundary for Electron process rendezvous and any
   helper or application group. Remove the ad-hoc-only library-validation
   exception once every component shares the authenticated identity.
3. Replace shared Application Support discovery with a signed broker/helper
   contract that lets the standalone CLI find and authenticate the app without
   broad filesystem exceptions.
4. Store a read-only security-scoped bookmark with each locally opened source,
   refresh stale bookmarks, bracket every access, and make revocation an
   ordinary recoverable state.
5. Decide whether repository-level metadata is worth a separate folder grant.
   Otherwise degrade Git, favicon, and agent-session enrichment explicitly.
6. Add a container migration manifest for reviews, attachments, settings, and
   workspace state, preserving a complete pre-migration backup.
7. Re-run the complete packaged lifecycle on Apple Silicon and Intel: open,
   persist, restart, restore, CLI handoff, attachment, clipboard, link opening,
   migration, and rollback.

These are product and ownership changes, not entitlement-file cleanup. They
should not be folded into Developer ID signing merely because a Team ID becomes
available.

## User-visible cost

- Existing local reviews need a one-time container migration before the
  sandboxed build mutates them.
- Restoring original-file freshness requires persisted consent. A moved,
  revoked, or stale source may need to be selected again.
- Repository context may require a second folder-level choice or become
  unavailable.
- Agent metadata enrichment and automatic title discovery may degrade unless
  users separately authorize their data roots and executables.
- CLI continuity depends on installing and maintaining a signed broker/helper;
  a plain portable script can no longer depend on shared app-private files.

Markover never edits the selected Markdown source today, so the future file
grant should remain read-only.

## Migration and rollback

Apple supports a `container-migration.plist` manifest that moves existing
support files into a new sandbox container on first launch. An adoption slice
must use a release-candidate copy of the complete Application Support tree,
validate the migrated copy independently, and retain a byte-for-byte
pre-migration backup before promotion.

Rollback is not simply launching the previous unsandboxed app: the older build
expects `~/Library/Application Support/Markover`, while the sandboxed build
uses its container. The release must therefore stop all Markover processes,
verify the selected backup, restore it atomically to the old location, and
leave the container untouched for diagnosis or a later retry. Unknown review
schema versions continue to fail closed under the existing compatibility
contract.

## Completion and follow-up

The feasibility question is complete when the Intel probe and the Apple
Silicon PR check both retain sanitized evidence and the normal local CI gate
passes. Human interaction is not counted as passed under the current deferred
QA policy; it becomes mandatory only in a future adoption issue with a real
Developer ID/Team-ID build.

No new implementation issue is warranted yet. Existing issue
[#13](https://github.com/lastobelus/markover/issues/13) is the trigger: after
Developer ID access is active, the maintainer can choose whether the measured
confinement benefit justifies a separately scoped broker/bookmark/migration
project. Until that choice, the current hardened-runtime and renderer-sandbox
release path remains the supported boundary.

## References

- [Apple: App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)
- [Apple: Accessing files from the macOS App Sandbox](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
- [Apple: Migrating files to an App Sandbox container](https://developer.apple.com/documentation/security/migrating-your-app-s-files-to-its-app-sandbox-container)
- [Apple: Incoming network connections entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.server)
- [Apple: Outgoing network connections entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client)
- [Electron: Mac App Store submission guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide/)
- [Electron: Security-scoped dialog bookmarks](https://www.electronjs.org/docs/latest/api/dialog#bookmarks-array)
- [Electron: `app.startAccessingSecurityScopedResource`](https://www.electronjs.org/docs/latest/api/app#appstartaccessingsecurityscopedresourcebookmarkdata-mas)
