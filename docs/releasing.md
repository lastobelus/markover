# Releasing Markover

This is the canonical maintainer runbook for provenance, draft review,
publication, withdrawal, rollback, and the future Apple-verified transition.
GitHub Actions is the only authoritative producer of official releases; local
packages are development builds.

## Current trust boundary

Markover releases are hardened and ad-hoc signed. They are **not
Apple-verified**, do not identify an authenticated Developer ID publisher, are
not notarized, and are expected to require a visible per-app Gatekeeper
override. Every release note must state this at the download point.

Ad-hoc signatures have no common Team ID, so the exact app and helper
entitlement profiles disable library validation only to load Electron's
separately signed framework. Frameworks and other embedded code retain library
validation. Final-artifact preflight rejects the exception on any other signed
component; a future Developer ID activation should remove it when all
components share a Team ID.

Developer ID signing and notarization remain blocked until Apple Developer
Program access exists and a separate reviewed change explicitly selects the
`developer-id` trust mode. Adding credentials alone must never activate or
downgrade a release path.

## Verified repository safeguards

The compatible slice-2 workflow is on `main`. Existing `v0.1.0` and `v0.1.1`
releases remain untouched historical releases. The live release safeguards have
been verified `ready`:

- Immutable releases are enabled for future published releases; drafts remain
  editable until publication.
- The protected `release` environment requires `lastobelus`, permits
  self-approval while there is one maintainer, disallows administrator bypass,
  and accepts only `v*` tags. The workflow uses it once for ordered draft
  staging and again for publication approval.
- One active ruleset restricts exactly `refs/tags/v*` creation through the
  explicit `lastobelus` user bypass.
- A separate unbypassable ruleset blocks updates and deletion for exactly
  `refs/tags/v*`.

Re-check this state without mutating it before every release:

   ```sh
   npm run release:preflight -- github-readiness \
     --repository=lastobelus/markover
   ```

The readiness command must report `ready`. A `blocked` result identifies an
expected missing safeguard; `failed` means a fact was unavailable or malformed
and must not be guessed.

## Slice-3 merge boundary

The slice-3 implementation may merge after required CI is clean, automated
Codex review has completed, every actionable finding is addressed, and Codex
reports approval or no issues. After merge, stop and report readiness. Do not
change versions, create a tag, create or approve a draft, or publish a release
without explicit maintainer approval for the version/release operation.

After that approval, the first-release sequence is:

1. Select a stable version newer than every preserved tag and update the root
   and bootstrap CLI versions together.
2. Merge the version change to protected `main` and wait for required CI on
   that exact commit.
3. Confirm GitHub readiness is `ready` and Developer ID readiness is
   intentionally `blocked`.
4. Create the immutable version tag from that verified `main` commit.
5. Approve the oldest pending tag at the first `release` gate to create the
   complete draft.
6. Run the clean Intel/Sonoma procedure below against the exact authenticated
   draft downloads, including version-pinned rollback.
7. Record the accepted evidence on issue 13 without serial numbers or account
   details.
8. Approve the separate publication job and verify the unchanged immutable
   release.
9. Update the signing-preflight ELI5 truth context.

## Prepare a stable release

1. Choose a stable `vMAJOR.MINOR.PATCH` version strictly newer than every
   preserved stable tag. The stable release explicitly designated
   `latest` is the known-good rollback target, which may be older than a
   withdrawn version. Prerelease tags use a separately reviewed
   workflow; they do not pass this workflow's stable-release gate.
2. Update the root and bootstrap CLI package versions together.
3. Merge the version change to protected `main` and wait for both required CI
   checks on that exact commit.
4. Run `github-readiness` and confirm it reports `ready`.
5. Confirm Developer ID is still intentionally blocked unless the separately
   reviewed activation has landed:

   ```sh
   npm run release:preflight -- developer-id-readiness
   ```

   The present ad-hoc contract prints `blocked` and exits nonzero by design.
6. Create and push the immutable version tag from the verified `main` commit.
   Do not move or reuse a version tag after creation.

## Draft, test, approve, and publish

The tag-triggered workflow performs four fail-closed stages:

1. It verifies stable SemVer, package-version agreement, protected-main
   ancestry, and successful required CI on the tagged commit.
2. Unprivileged native jobs build separate Apple Silicon and Intel app ZIPs,
   verify each final ASAR layout, smoke each signed application, verify the
   exact final ZIP bytes, and build the matching bootstrap CLI.
3. The staging job waits at the protected `release` environment. Approve only
   the oldest pending tag. Its oldest-run-first gate waits for every earlier
   release run before selecting the current rollback target, independently
   rehashing all payloads, generating attestations and notes, and creating one
   complete draft. Unapproved jobs remain preserved at the environment gate;
   Actions concurrency's replaceable pending slot is not used.
4. After clean-machine evidence, approve the `publish-release` job at the same
   protected environment. It downloads the draft assets by release ID, compares
   every byte and metadata field with the staged set, and verifies attestations.
   In the final publication step it refetches the complete draft and all six
   assets, compares them again, revalidates the rollback release, and publishes
   without uploading or changing anything.

For the first post-policy release, leave the publish job waiting while the
dedicated Sonoma Intel machine downloads the exact draft assets and completes
the clean-machine exercise owned jointly with issues 11 and 13. Record version,
digests, Mac model class, macOS version, Gatekeeper result, rollback target,
and workflow/release links without serial numbers or account details. Approve
publication only after that evidence passes.

If a failed or interrupted run leaves a draft for the tag, do not rerun blindly
or replace individual assets. Confirm in GitHub that the release is still a
draft for that exact unpublished tag. Then make an explicit maintainer decision
to delete only the draft release—not the tag—and rerun the whole workflow so a
single run produces and verifies the complete set again.

## Shared packaged smoke evidence

Each native release builder runs the same narrow happy path against its exact
final ZIP and retains `packaged-smoke-arm64.json` or
`packaged-smoke-x64.json` in a separate `packaged-smoke-*` workflow artifact.
Keeping these outside the exact toolchain-report directory preserves the
release staging contract. The runner:

1. repeats final-ZIP checksum, structure, architecture, signing, entitlement,
   and expected ad-hoc Gatekeeper verification;
2. when an installed app is supplied, requires its complete bundle contents to
   match the verified ZIP while leaving quarantine attributes intact;
3. launches the packaged app and uses the shared issue-12 fixture helpers to
   create/open one real review;
4. confirms the review is saved before a normal app restart;
5. relaunches the same packaged app and confirms the saved review restores;
6. runs CLI get and edit/reopen and confirms the reopened state on disk; and
7. writes versioned, sanitized JSON evidence while preserving the review.

This is not issue 12's adversarial authorization suite and does not send
unauthorized or mismatched credentials. It is not issue 39's durability suite
and does not crash the app, measure a loss window, race writes, or claim a
bounded-loss guarantee.

### Clean Intel/Sonoma procedure

Use the dedicated 2019 Intel Mac running Sonoma. Keep it isolated from normal
Markover work and quit any running Markover before starting.

1. Through authenticated Safari, download the complete exact draft asset set,
   including both native ZIPs and sidecars plus `markover-cli.tgz`. Record the
   draft and workflow links. Do not substitute `latest` assets.
2. Verify every digest and GitHub build attestation as described below. Record
   the x64 ZIP digest used for the machine exercise.
3. Extract the x64 ZIP into a dedicated installation directory while preserving
   extended attributes. Confirm the app still has Safari's quarantine marker:

   ```sh
   /usr/bin/xattr -p com.apple.quarantine \
     "/path/to/installed/Markover.app"
   ```

4. Control-click **Open**. Confirm Gatekeeper blocks the ad-hoc app, then use
   **System Settings → Privacy & Security → Open Anyway** for this app. Never
   remove quarantine recursively. After the approved app opens, quit it so the
   scripted restart exercise begins from a stopped state.
5. From the exact tagged source checkout, run the shared packaged smoke. Choose
   a new evidence path; the command refuses to overwrite evidence:

   ```sh
   npm run smoke:packaged -- \
     --archive=/path/to/Markover-darwin-x64.zip \
     --checksum=/path/to/Markover-darwin-x64.zip.sha256 \
     --architecture=x64 \
     --version=VERSION_WITHOUT_V \
     --trust-mode=ad-hoc \
     --app=/path/to/installed/Markover.app \
     --evidence-kind=clean-intel-sonoma \
     --evidence=/path/to/issue-13-clean-intel-evidence.json
   ```

   Before launch, the runner extracts the verified ZIP again and rejects the
   installed app unless its tree, bytes, executable modes, and symlink targets
   match. Safari quarantine metadata is allowed to differ and remains required.

6. Confirm the JSON says `format: "markover-packaged-smoke-evidence"`,
   `status: "passed"`, `cleanMachine: true`, names the
   expected source commit, x64 digest, model class, Sonoma version, expected
   ad-hoc Gatekeeper rejection, quarantine, launch, saved-state restart,
   restoration, CLI open/get/edit, and edit/reopen results. It must also say
   `appleVerified: false`, `notarized: false`, and list adversarial authorization
   and bounded-loss durability as exclusions.
7. Quit Markover and back up the complete Application Support directory. Run
   the exact version-pinned rollback command from the draft notes, reopen the
   preserved smoke review, and confirm its already-saved state remains usable.
   Record rollback separately because the packaged smoke JSON deliberately
   covers only the shared happy path.

### Issue 13 evidence format

Post one issue comment only after the real clean-machine run passes. Use this
shape and omit serial numbers, usernames, paths containing account names, and
Apple/GitHub account details:

```markdown
### First post-policy clean Intel evidence — vX.Y.Z

- Source commit: `<40-hex commit>`
- Draft / workflow: `<authenticated draft link>` / `<Actions run link>`
- Exact assets: `arm64 <sha256>`; `x64 <sha256>`; `CLI <sha256>`
- Automated native smoke: `arm64 passed` / `x64 passed` with workflow-artifact links
- Clean host: `2019 Intel MacBook class`; `macOS 14.x Sonoma`; `x86_64`
- Trust result: `hardened ad-hoc`; `not Apple-verified`; `not notarized`;
  `Gatekeeper rejected before the visible per-app override`
- Clean packaged smoke: `<source commit>` / `<x64 digest>` / `<review ID>` / `passed`
- Covered: launch; CLI create/open; saved state before restart; restart/restoration;
  CLI get; CLI edit/reopen; reopened state on disk
- Excluded: adversarial authorization (#12); bounded-loss durability (#39)
- Rollback target / command: `vA.B.C` / `<exact version-pinned command>`
- Rollback result: `<passed or failed, with preserved-review observation>`
- Overall result: `<accepted or rejected>`
```

The JSON file is machine evidence for the packaged happy path. The issue
comment joins that result to the attestation, Gatekeeper, installation, and
rollback observations needed for the release decision. Do not mark the clean
machine or overall result passed before those actions actually occur.

## Verify a published release

Download each primary payload and its `.sha256` sidecar from the release. Check
the digest, then verify that GitHub attests the release workflow as signer:

```sh
shasum -a 256 -c Markover-darwin-arm64.zip.sha256
gh attestation verify ./Markover-darwin-arm64.zip \
  --repo lastobelus/markover \
  --signer-workflow lastobelus/markover/.github/workflows/release.yml \
  --source-digest COMMIT_FROM_RELEASE_NOTES \
  --source-ref refs/tags/TAG_FROM_RELEASE_NOTES \
  --deny-self-hosted-runners
```

Repeat this for the Intel ZIP and `markover-cli.tgz`. Confirm the release notes
name the exact source commit, Actions run, resolved toolchains, three digests,
current ad-hoc trust state, and preceding known-good rollback version.

## Roll back safely

Quit Markover before rollback. Back up the complete Application Support
directory, including review JSON and attachments:

```sh
markover_backup="$PWD/Markover-backup-$(date +%Y%m%d-%H%M%S)"
ditto "$HOME/Library/Application Support/Markover" "$markover_backup"
```

Use the exact version-pinned launcher command in the release notes. It downloads
the named CLI and that CLI downloads the matching architecture-specific app
from the same versioned release. Do not substitute a `latest` URL.

Rollback is guaranteed only between releases using the same review-data
format. A format-changing release must add tested backup, migration, and
restore behavior before its notes may call rollback safe.

## Withdraw a defective release

Published bytes are never replaced beneath an existing tag or filename.

1. Mark the defective version clearly as withdrawn in its title and notes.
2. Point `latest` back to the documented preceding known-good release.
3. Publish the fix under a new, strictly greater version and preserve the
   withdrawal reason in its notes.
4. Never reuse the withdrawn tag.

If an immutable release is actively dangerous, deleting the entire release is
an exceptional incident action requiring an explicit maintainer decision. Do
not use `--cleanup-tag`; preserve the non-reusable tag and document the incident
and replacement version publicly.

## Future Developer ID activation

Activation is a separate reviewed implementation. It must add one Developer ID
Application identity for both architectures, import its PKCS#12 into a random
temporary keychain, authenticate `notarytool` with an App Store Connect Team API
key, enable secure timestamping, notarize both native apps independently,
staple and validate tickets before ZIP creation, and change final downloaded
artifact assessment to successful `spctl` verification.

The trusted workflow must fail closed during certificate, credential, or Apple
service failures. It must never fall back to ad-hoc signing. Any explicitly
requested emergency ad-hoc release remains a separate approved prerelease
workflow that leaves `latest` on the last Developer ID release.
