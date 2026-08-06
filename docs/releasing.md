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

Developer ID signing and notarization remain blocked until Apple Developer
Program access exists and a separate reviewed change explicitly selects the
`developer-id` trust mode. Adding credentials alone must never activate or
downgrade a release path.

## One-time repository safeguards

Apply these settings only after the compatible slice-2 workflow has merged to
`main`. Existing `v0.1.0` and `v0.1.1` releases remain untouched historical
releases.

1. Create a `release` environment in **Settings → Environments**. Require
   `lastobelus` as reviewer, leave “Prevent self-review” disabled while there is
   one maintainer, and restrict deployment branches and tags to `v*` tags.
2. Create an active tag ruleset for `refs/tags/v*` that restricts tag creation
   to the maintainer through an explicit bypass.
3. Create a separate active tag ruleset for the same pattern that blocks tag
   updates and deletion with no bypass actors. Separating these rules lets the
   maintainer create a version while preventing anyone—including the
   maintainer—from moving or reusing it.
4. Enable immutable releases in **Settings → General → Releases**. Immutability
   applies to future published releases; drafts remain editable until
   publication.
5. Verify the resulting state without mutating it:

   ```sh
   npm run release:preflight -- github-readiness \
     --repository=lastobelus/markover
   ```

The readiness command must report `ready`. A `blocked` result identifies an
expected missing safeguard; `failed` means a fact was unavailable or malformed
and must not be guessed.

## Prepare a stable release

1. Choose a stable `vMAJOR.MINOR.PATCH` version strictly newer than the latest
   published stable release. Prerelease tags use a separately reviewed
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
   verify their exact final bytes, and build the matching bootstrap CLI.
3. A staging job independently rehashes all payloads, generates GitHub
   build-provenance attestations, writes provenance and rollback release notes,
   and creates one complete draft release. Sanitized build context remains in
   workflow artifacts rather than permanent release assets.
4. The `publish-release` job waits at the protected `release` environment.
   After approval, it downloads the draft assets by release ID, compares every
   byte and the draft metadata with the staged set, verifies attestations, and
   publishes without uploading or changing anything.

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
