# Signing, provenance, and architecture release plan

## Status and objective

Issue #13 remains the canonical trust and release-provenance work item. Its
credential-free implementation is merged: PR #45 hardened ad-hoc packaging and
bootstrap verification, PR #55 added guarded draft-first release operations,
and PR #68 added shared exact-ZIP packaged smoke evidence. PR #78 then aligned
the root and bootstrap CLI versions at `0.1.2` and merged as
`0461b673ef2817cd7342f23bb9a82912f06d1512`.

The immutable `v0.1.2` tag points to that verified commit. Workflow run
31217557046 built and verified both native architectures and assembled a
six-asset private draft, but its publication job was cancelled before release.
No clean physical Intel/Sonoma evidence was claimed and `v0.1.2` was never
published.

The first guarded Apple Silicon release is now published without waiting for
Intel hardware. PR #81 merged the exact four-asset release contract as
`03e52ac083091ce23f7b0ea91f7065d75394552e`. Immutable `v0.1.3` was produced
and published by workflow run 31221075875 with one native app artifact,
`Markover-darwin-arm64.zip`, plus its checksum and the portable bootstrap CLI
with its checksum.

The primary digests are
`4219a1f2e5369d4091f94e76f1373bd12fa98b8867f95e0e173d45bd0b38c3c6`
for the arm64 ZIP and
`7f7d30e620fcc3044563745fc827d0269641d6dc654fbe99afcab5a8d2496e97`
for the CLI. The retained CI evidence covers the packaged happy path and says
`cleanMachine: false`; clean-machine Apple Silicon validation remains issue
#11 and no Intel evidence is claimed.

Native Intel release activation and exact physical Intel/Sonoma evidence are
deferred to issue #80 in the Broad announcement roadmap. Future Developer ID
signing and notarization remain in issue #13 and are intentionally blocked by
the absence of Apple Developer Program access.

## Current verified baseline

- Official release bytes are produced only by GitHub Actions from immutable
  `v*` tags on CI-passing protected `main` commits.
- GitHub release readiness is verified `ready`: immutable releases are enabled;
  the protected `release` environment requires `lastobelus`, permits
  self-approval, disallows administrator bypass, and accepts only `v*` tags;
  `v*` creation uses the explicit maintainer bypass; updates and deletion are
  blocked without bypass.
- Developer ID readiness is intentionally `blocked`. Releases remain hardened
  ad-hoc signed, not Apple-verified, and not notarized.
- Packaging enforces macOS 14 Sonoma, strict inside-out code sealing, hardened
  runtime, explicit minimal per-component entitlements, exact bundle/helper
  identities, and final-ZIP architecture and checksum verification.
- The bootstrap is dependency-free, validates a downloaded app before atomic
  caching, and keeps successful CLI stdout to one JSON value.
- Shared packaged smoke uses issue #12 happy-path helpers for launch,
  create/open, persistence before restart, restart/restoration, CLI get,
  CLI edit/reopen, and reopened state on disk. It excludes issue #12 adversarial
  authorization and issue #39 bounded-loss durability.
- Review data remains under `~/Library/Application Support/Markover`, separate
  from versioned app caches. Rollback is supported only while releases share
  the same review-data format and begins with a full Application Support backup.

## Public support and release boundary

The current downloadable product supports macOS 14 Sonoma or newer on Apple
Silicon. The public bootstrap must reject Intel before attempting a download
and explain that native Intel releases are deferred to issue #80.

This does not delete the x64 packaging, artifact-preflight, or packaged-smoke
primitives. They remain tested development capabilities needed by issue #80.
Continuous integration may continue to exercise both native implementations,
but only the explicit release payload set is a supported public release.

The current release set is exactly:

1. `Markover-darwin-arm64.zip`
2. `Markover-darwin-arm64.zip.sha256`
3. `markover-cli.tgz`
4. `markover-cli.tgz.sha256`

No manual Intel upload, universal binary, DMG, installer, auto-update system,
or fallback asset lookup is added. An extra or missing draft asset fails closed.

## Apple Silicon release implementation

### Unprivileged build and smoke

The tag workflow runs repository verification, then builds the Apple Silicon
app on the native `macos-15` runner and the portable CLI on Linux. The app job:

1. packages the hardened ad-hoc app;
2. creates the exact arm64 ZIP and checksum;
3. records sanitized arm64 toolchain context;
4. verifies structure, version, architecture, signing, entitlements, macOS
   floor, and expected ad-hoc Gatekeeper rejection;
5. runs the shared packaged happy path against that exact ZIP; and
6. retains package and smoke artifacts separately.

The x64 release runner is absent. The ordinary CI workflow may retain native
x64 regression coverage because CI evidence is not a public Intel artifact.

### Privileged staging

The first protected-environment gate admits only the oldest pending release
run. Staging selects the current published known-good rollback release,
downloads the arm64 and CLI artifacts, requires the exact four-file payload
set, verifies sidecars, generates two build-provenance attestations, and writes
release notes from verified facts.

The notes must state Apple Silicon-only compatibility, hardened ad-hoc trust,
no authenticated publisher, no notarization, expected Gatekeeper override,
the exact tag/commit/workflow, both payload digests and toolchains, attestation
verification, and the exact version-pinned rollback command. They must not
claim bit-for-bit reproducibility or Apple verification.

The staging job creates one complete four-asset draft. It never mutates a prior
draft or uploads an individual replacement.

### Immutable publication

The separate publication job waits at the same protected environment. After
approval it downloads draft assets by release ID, regenerates notes from the
same build outputs, compares every byte and metadata field, verifies both
attestations, revalidates the rollback target, refetches the complete draft,
and publishes without uploading or changing anything.

The user has authorized publication of the Apple Silicon-only release after
these controls pass. No physical Intel evidence is a publication gate for this
release.

## Completed v0.1.3 release sequence

1. PR #81 merged the Apple Silicon release-contract change to protected `main` after
   local checks, required CI, completed automated Codex review, and resolution
   of every actionable finding.
2. Root and bootstrap CLI versions were synchronized at `0.1.3`; required CI
   passed on exact protected-main commit `03e52ac`.
3. GitHub readiness reported `ready`; Developer ID readiness remained
   intentionally `blocked`.
4. Annotated immutable tag `v0.1.3` was created from that verified commit.
5. The oldest pending tag passed the first protected release gate.
6. The complete draft contained exactly four assets, and its notes,
   sidecars, digests, attestations, packaged-smoke evidence, source commit, and
   rollback target agree.
7. The separate publication job reverified and published the unchanged
   immutable release.
8. The release checkpoint was recorded on issue #13; this document and the
   ELI5 truth context record the published result.

The private `v0.1.2` draft may remain as historical audit evidence. Its
publication job stays cancelled, its tag is never moved or reused, and none of
its Intel bytes become public release assets.

## Deferred native Intel work — issue #80

Issue #80 is a Broad announcement sub-issue of #5 and blocks #18. It owns:

- re-enabling an explicit x64 release payload without weakening the exact-set,
  provenance, protected-environment, immutable-tag, or rollback contracts;
- authenticated Safari download of the exact Intel-enabled draft on the
  dedicated physical 2019 Intel Mac running Sonoma;
- preserved quarantine, observed ad-hoc Gatekeeper rejection, and the visible
  per-app override;
- installed-app byte matching and the shared packaged happy path;
- saved-review restoration after restart, CLI open/get/edit, reopen/edit, and
  version-pinned rollback; and
- sanitized evidence containing version, commit, digests, model class, macOS,
  native x86_64 state, Gatekeeper result, rollback target, and workflow/release
  links without serial numbers, usernames, or account details.

Issue #80 does not duplicate issue #12 adversarial authorization or issue #39
durability. It does not block Apple Silicon downloads or focused Apple Silicon
preview work. It must not describe ad-hoc builds as Apple-verified.

## Future Developer ID activation

Issue #13 stays open until Apple Developer Program access exists. Activation is
a separate reviewed implementation. Adding secrets alone cannot activate it.
The change must select explicit `developer-id` trust mode and add:

- the intended Developer ID Application identity for every then-supported
  native architecture;
- PKCS#12 import into a random temporary CI keychain;
- App Store Connect Team API authentication for `notarytool`;
- secure timestamping;
- independent notarization and ticket stapling before final ZIP creation; and
- strict code, ticket, and successful downloaded-artifact `spctl` validation.

The trusted workflow fails closed during certificate, credential, or Apple
service failures and never silently falls back to ad-hoc signing.

## Rollback and withdrawal

Every published release names one preceding published stable release and an
exact version-pinned bootstrap command. Before rollback, quit Markover and back
up the complete Application Support directory. Rollback claims apply only
within one review-data format.

Published bytes are never replaced beneath an existing tag or filename. A
defective release is marked withdrawn and followed by a strictly newer version;
`latest` returns to the known-good release. An actively dangerous immutable
release may be removed only as an explicit incident action, while its tag
remains non-reusable and the incident remains documented.

## Canonical decisions

1. `v0.1.2` remains an unpublished immutable historical attempt.
2. `v0.1.3` is the first published Apple Silicon-only guarded release.
3. Public release assets are arm64 plus the portable CLI, each with a sidecar.
4. The bootstrap rejects unsupported Intel hosts before downloading.
5. Internal x64 verification primitives and CI regression coverage may remain.
6. Native Intel release activation and clean Intel/Sonoma evidence belong to
   issue #80 at the Broad announcement gate.
7. Issue #13 retains Developer ID/notarization activation and honest trust
   language.
8. Hardened ad-hoc releases are not Apple-verified or notarized and are expected
   to require a visible per-app Gatekeeper override.
9. GitHub Actions alone produces official release bytes.
10. Stable tags are monotonic, protected, immutable, and point to CI-passing
    protected-main commits.
11. Staging and publication remain separate protected approvals.
12. Draft and publication verification require exact assets and unchanged bytes
    and metadata.
13. GitHub build attestations provide machine provenance; generated Markdown is
    the human-readable view.
14. Release qualification uses the shared packaged happy path but never expands
    into issue #12 adversarial auth or issue #39 durability.
15. Distribution remains ZIP-based, dependency-free at bootstrap, and free of
    compatibility fallbacks or dual release formats.
16. Developer ID activation remains blocked until Apple access exists and a
    separate reviewed change lands.
