# Signing and notarization preflight

## Status and objective

Issue 13 remains open. Markover cannot satisfy its Developer ID, notarization,
stapling, or Gatekeeper-success criteria because there is no paid Apple
Developer Program membership and the fee is not currently justified.

This work prepares everything that can be exercised without Apple credentials,
keeps releases honestly ad-hoc signed, and makes later Developer ID activation
a deliberate, small, separately reviewed transition. GitHub Actions remains the
only authoritative producer of official releases; local packages remain
development builds.

The work is delivered in three slices. Slice 1 merged through PR 45 on
4 August 2026. This session implements slice 2 from that accepted baseline,
commits it after verification, and stops before repository-setting activation,
tagging, publication, or slice 3.

## Current verified baseline

- Tags matching `v*` currently build separate Apple Silicon and Intel ZIPs plus
  `markover-cli.tgz` in GitHub Actions.
- The published `v0.1.1` arm64 app has bundle ID
  `com.lastobelus.markover`, version `0.1.1`, an internally valid ad-hoc code
  seal, no Team ID, and `LSMinimumSystemVersion = 12.0`; strict `codesign`
  verification passes and `spctl` rejects it.
- Release notes currently contain only generated changelog text. The ad-hoc
  trust limitation is disclosed in the README, guide, development docs,
  packaging output, and tests, but not at the release download point.
- No valid signing identity exists on the current Mac, and the repository has
  no Apple or release secrets.
- Review data lives under
  `~/Library/Application Support/Markover`, separately from versioned app
  caches. Released review data currently uses format version 1 and is written
  atomically, but there is no general downgrade migration or backup system.
- The repository is public. `main` has a ruleset, but `v*` tags are not
  protected. Existing `v0.1.0` and `v0.1.1` releases predate immutable-release
  policy.
- A 2019 Intel MacBook can be dedicated to the later clean-machine exercise.
- Slice 1 now enforces the hardened ad-hoc package, final-ZIP, and bootstrap
  installation contracts on `main`.

## Scope boundaries

This preflight does not buy an Apple membership, add untestable notarization
code, claim Apple verification, introduce bit-for-bit reproducibility, add a
DMG/installer, create a universal binary, add auto-update or rollback UI,
publish a release, or close issue 13.

Markover remains a direct-download, non-App-Sandboxed app. Hardened runtime is
in scope; App Sandbox is not. After shared-understanding review, file a separate
unmilestoned `enhancement` + `security` issue to evaluate sandbox feasibility,
including security-scoped file access, bookmarks, CLI/service IPC,
attachments, migration risk, and measurable security benefit.

Official support begins at macOS 14 Sonoma. Intel remains fully supported until
a separate explicit retirement decision and migration notice.

## Slice 1: hardened ad-hoc packaging and installation verification

### Packaging contract

Replace the final manual `codesign --deep --sign -` pass with Electron's
supported inside-out signing library. Copy notices and make every bundle
mutation before signing. Use an explicit committed trust mode of `ad-hoc`;
missing or unknown trust modes fail closed and credentials never select a mode.

Ad-hoc signing must use:

- identity `-`, with certificate lookup disabled;
- hardened runtime on every applicable executable component;
- timestamping disabled for the ad-hoc identity;
- strict verification and no continue-on-error behavior; and
- checked-in, minimal, per-component entitlements.

Grant `com.apple.security.cs.allow-jit` only where the current Electron runtime
demonstrably requires it. Do not inherit Electron's broad default device and
personal-information entitlements. Do not grant unsigned executable memory or
disable library validation unless a specific component fails without it and
the exception is documented and tested.

Preserve separate native `arm64` and `x64` ZIPs, the existing bundle/helper
identifiers, and existing asset names. Inject and verify
`LSMinimumSystemVersion = 14.0` before signing. Continue distributing a ZIP
containing `Markover.app`; a stapled Developer ID app will fit the same archive
contract later.

### Artifact preflight

Add a deterministic verifier with injected command execution for unit tests and
real macOS commands for packaged artifacts. Verification of the current trust
mode must cover:

- final ZIP checksum and safe extraction;
- expected filename, architecture, app version, bundle ID, helper IDs, and
  macOS floor;
- strict inside-out code-seal verification;
- ad-hoc signature, absent Team ID, and hardened-runtime flags;
- exact per-component entitlements, rejecting unexpected grants; and
- expected Gatekeeper rejection in ad-hoc mode.

Gatekeeper rejection is evidence of the declared current trust state, not a
passing publisher assessment. Future Developer ID mode changes that expectation
to a stapled-ticket validation and successful `spctl` assessment.

### Bootstrap install boundary

After checksum verification and extraction—but before the atomic cache
rename—the dependency-free bootstrap must validate the app's code seal, bundle
ID, architecture, supported macOS floor, and expected ad-hoc signature mode.
Any mismatch removes staging data and prevents cache or launch.

Full validation occurs on first installation of each version, not on every
later `open`, `get`, or `edit`. On first install, print a concise
noninteractive warning to stderr that the app is not Apple-verified and link to
safe opening guidance. Preserve strict JSON-only stdout.

Opening guidance uses Control-click **Open** or **Privacy & Security -> Open
Anyway**. Do not recommend recursively deleting quarantine attributes.

### Slice 1 documentation

Update the README, user guide, development guide, tests, and decision record so
they agree on:

- macOS 14 Sonoma or newer;
- Apple Silicon and Intel support;
- hardened but ad-hoc signing, with no authenticated publisher or
  notarization;
- expected Gatekeeper behavior and safe per-app override;
- install-time checksum and structural/signature validation; and
- the Apple Developer membership prerequisite, while keeping personal
  financial rationale out of user-facing installation text.

### Slice 1 verification and stop point

Run lint, type checking, notice verification, and the full test suite. Add
branch-complete unit coverage for command failures, malformed metadata,
architecture mismatch, unexpected signature modes, entitlement drift, cleanup,
and stderr/stdout behavior. Build a real package on the current Mac and run the
native artifact verifier against its final ZIP.

Slice 1 does not duplicate issue 12's protocol smoke fixture. Commit the tested
slice and stop for review before changing release permissions or publication.

## Slice 2: provenance, release operations, and rollback

After slice 1 is accepted, revise the release workflow with these controls:

1. Require a strictly increasing stable SemVer tag whose commit is contained in
   protected `main` and has passed required CI.
2. Keep architecture builds parallel, unprivileged, native, and all-or-nothing
   with the matching CLI payload.
3. Pin actions to full commit SHAs and scope permissions per job.
4. Serialize final publication in one non-cancelling concurrency group.
5. Independently rehash downloaded build outputs in the privileged job before
   attestation or draft attachment; no bytes change afterward.
6. Generate GitHub Actions build-provenance attestations for both app ZIPs and
   `markover-cli.tgz` while retaining SHA-256 sidecars.
7. Generate concise release Markdown containing source tag/commit, workflow and
   resolved toolchain context, architectures, digests, ad-hoc trust status,
   attestation verification, the preceding known-good version, and its exact
   rollback command. Do not claim reproducibility or add a custom manifest.
8. Assemble a complete draft release before publication. Detailed sanitized
   verification logs remain workflow artifacts rather than permanent release
   assets.
9. Publish only through a protected `release` environment requiring the sole
   maintainer's explicit approval; self-approval remains permitted while there
   is one maintainer.

Add one Git-style human-facing preflight command with subcommands for current
ad-hoc release verification and future Developer ID readiness. The subcommands
provide concise reports and exit statuses, not a stable JSON API. Signing
readiness reports `ready`, intentionally `blocked`, or unexpectedly `failed`;
every non-ready result exits nonzero. Its read-only GitHub checks query
immutable releases, the release environment, and `v*` tag rules through
authenticated `gh`, reporting unavailable facts rather than guessing offline.

Create a canonical public maintainer release runbook covering preflight,
provenance verification, draft publication, withdrawal, rollback, and future
activation. README, guide, and development docs contain audience-specific
summaries and links.

## Rollback and withdrawal contract

User rollback is an explicit version-pinned launcher command against immutable
GitHub Release assets; there is no updater or rollback UI. Each release names
one preceding known-good version and exact command. Before rollback, stop
Markover and back up the entire Application Support directory.

Rollback is guaranteed only across releases sharing the same review-data
format. Any future format-changing release must add tested backup, migration,
and restore behavior before it can be called rollback-safe.

Published bytes are never replaced beneath an existing tag or filename. A
defective release is marked withdrawn and followed by a newly versioned
release; `latest` returns to the known-good release. An actively dangerous
immutable release may be removed as a whole, but its tag name is never reused
and the incident remains documented.

## GitHub setting activation order

Existing `v0.1.0` and `v0.1.1` releases remain untouched historical
pre-policy releases. Do not enable new repository settings while the compatible
workflow exists only on a branch.

After slice 2 merges to `main`, verify the proposed mutations, then:

1. create the protected `release` environment;
2. add a tag ruleset restricting `v*` creation to maintainers and preventing
   tag update/deletion;
3. enable GitHub immutable releases for future releases; and
4. rerun the read-only readiness check.

Immutable releases lock assets and tags and add GitHub's release attestation.
Keep the explicit Actions build attestations because they prove workflow
origin, while the release attestation proves the published collection.

## First post-policy release and clean-machine evidence

The implementation work does not bump versions, create tags, or publish a
release. The first later release uses a two-stage process:

1. Actions creates a complete draft.
2. On the dedicated 2019 Intel Mac running Sonoma, download the exact draft
   assets through authenticated Safari and exercise quarantine, safe Gatekeeper
   override, install, an already-saved review, restart, and version-pinned
   rollback.
3. A separate approved Actions job revalidates unchanged draft digests and
   publishes the immutable stable release.

Record the tested version/digests, Mac model class, macOS version, Gatekeeper
result, rollback target, and workflow/release links on issue 13 without serial
numbers or account details. Routine later releases rely on automated native
checks plus one approval. Repeat clean-machine testing only when signing,
packaging, bootstrap installation, review-data format, rollback behavior, or
minimum-macOS policy changes.

## Slice 3: shared packaged smoke evidence

Issue 12 owns the reusable protocol-v2 authentication smoke fixture and
development evidence. Issue 39 owns bounded-loss, crash timing, concurrent
writes, and durability. Issue 13 must not duplicate either suite.

After issue 12's fixture lands, run only its happy path against both packaged
native apps and on the clean Intel machine: launch, create/open, persist,
restart, restore already-saved state, hand off/get, and reopen/edit. Issue 13
may proceed independently of issue 39 and must not assert bounded-loss or
adversarial-auth behavior. It is not complete until the shared packaged smoke
is available.

## Future Developer ID activation contract

Developer ID activation is a separate reviewed change. Adding secrets alone
cannot activate it. The change must select explicit `developer-id` trust mode,
retain minimal entitlements and hardened runtime, and add:

- one intended Developer ID Application identity for both architectures;
- a PKCS#12 certificate imported into a random temporary CI keychain;
- an App Store Connect Team API key for `notarytool` authentication;
- secure timestamping;
- independent notarization of both native apps;
- ticket stapling and validation before creation of final ZIPs; and
- strict `codesign` and successful downloaded-artifact `spctl` assessment.

The trusted workflow fails closed during certificate, credential, or Apple
service failures. It never silently falls back. After activation, an explicitly
requested ad-hoc escape hatch remains available only through a separate manual
workflow using a new SemVer prerelease tag, protected approval, full ad-hoc
verification and attestations, prominent warnings, and `latest` left on the
last Developer ID release.

## Canonical decision ledger

1. Future ZIP distribution uses a Developer ID Application certificate.
2. Developer ID builds use hardened runtime.
3. Future notarization uses `notarytool`, stapling before the final ZIP.
4. Signing is inside-out through supported Electron tooling, never a final
   `--deep` release pass.
5. Trusted releases require strict code, ticket, and Gatekeeper validation.
6. GitHub Actions alone produces official releases; local builds are ad-hoc.
7. No paid Apple membership is currently justified; ad-hoc signing continues.
8. This is credential-free preflight; issue 13 remains blocked on Apple access.
9. Public docs disclose trust limits; engineering records the membership gate.
10. Do not add unexercised future signing code; add executable readiness and a
    runbook.
11. Every ad-hoc release discloses Gatekeeper rejection at its download point.
12. Current artifact preflight gates every tagged release.
13. Opening guidance uses visible per-app macOS overrides, never blanket
    quarantine removal.
14. The bootstrap validates extracted release structure and code seal.
15. Primary payloads receive GitHub build attestations; standalone Sigstore is
    unnecessary.
16. Bit-for-bit reproducibility is not required or claimed.
17. Releases publish a concise generated provenance statement.
18. Rollback uses version-pinned launchers, not update UI.
19. Rollback safety applies within one review-data format.
20. Rollback begins with a full Application Support backup.
21. Automated release qualification covers both architectures.
22. CI is supplemented by one clean-machine exercise.
23. `spctl` rejection is expected for ad-hoc and success for Developer ID.
24. Manual validation uses an isolated Mac environment.
25. Published artifact bytes are immutable and never silently replaced.
26. Every release names one tested known-good rollback target.
27. Withdrawal repoints `latest` to that known-good release.
28. Current verification and future readiness are subcommands of one command.
29. GitHub attestations are machine provenance; Markdown is the human view.
30. Release statements are generated from verified facts.
31. Actions are SHA-pinned and permissions are job-scoped.
32. Publication uses an approved `release` environment with self-approval.
33. Future notarization uses an App Store Connect Team API key.
34. Future certificate import uses an ephemeral keychain.
35. Developer ID activation requires a separate reviewed change.
36. Signed entitlements are explicit, minimal, and tested per component.
37. Hardened runtime and minimal entitlements are exercised under ad-hoc now.
38. Apple Silicon and Intel remain separate native archives.
39. Distribution remains ZIP, not DMG or installer.
40. Bootstrap stays dependency-free; attestation checks are optional to users.
41. Full bootstrap verification runs at install, not every command.
42. Official support begins at macOS 14 Sonoma.
43. Packaging enforces `LSMinimumSystemVersion = 14.0`.
44. The Intel clean machine tests the minimum supported OS.
45. Intel retirement requires a future explicit decision and notice.
46. App architectures and CLI publish atomically as one release set.
47. Publication is serialized and never cancelled by a newer release.
48. Normal stable releases increase SemVer monotonically.
49. Tags must point to CI-passing commits contained in protected `main`.
50. No separate maintainer-signed tag key is required.
51. `v*` tag creation is restricted and tags are immutable.
52. Future releases are draft-first and GitHub-immutable.
53. Build and immutable-release attestations are both retained.
54. Detailed sanitized diagnostics stay as workflow artifacts.
55. User language leads with “not Apple-verified.”
56. First install warns noninteractively on stderr.
57. A dedicated public release runbook is canonical.
58. Issue 13 stays open after credential-free work merges.
59. GitHub safeguards are applied as repository settings, not docs alone.
60. Existing releases remain untouched historical releases.
61. This implementation does not version, tag, or publish.
62. Verification combines deterministic unit tests and real native commands.
63. Packaged apps receive a minimal native happy-path smoke test.
64. Verification targets the exact final ZIP.
65. The privileged publisher independently rehashes all payloads.
66. Issues 12, 39, and 13 own auth, durability, and packaged evidence
    respectively.
67. Issue 13 consumes issue 12's fixture and does not duplicate it.
68. Issue 13 does not own bounded-loss durability from issue 39.
69. Readiness checks external GitHub settings read-only through `gh`.
70. Preflight has human output and exit codes, not a stable JSON contract.
71. Signing readiness distinguishes ready, blocked, and failed.
72. Trust mode is explicit, committed, and fail-closed.
73. The clean Intel exercise qualifies the first later release, not this PR.
74. That release uses draft-test-revalidate-publish staging.
75. Clean-machine testing repeats only when its contract changes.
76. Clean-machine evidence is recorded on issue 13 without sensitive IDs.
77. Future Developer ID releases never downgrade automatically.
78. Explicit emergency ad-hoc releases use a separate prerelease workflow.
79. App Sandbox remains outside issue 13.
80. A future unmilestoned security enhancement evaluates App Sandbox.
81. Repository settings activate only after compatible workflow reaches `main`.
82. Issue 13 is delivered in three reviewable slices.
83. Slice 1 merged through PR 45; this session implements and commits only
    slice 2.
84. This plan was reviewed in Markover before slice 1 and remains the canonical
    decision source for slice 2.

## Review gate

The plan is approved and slice 1 is merged. Execute slice 2 only. Do not change
repository settings, create a tag or release, record clean-machine evidence, or
begin slice 3 from this implementation branch. Repository-setting activation
occurs only after the compatible workflow reaches `main`.
