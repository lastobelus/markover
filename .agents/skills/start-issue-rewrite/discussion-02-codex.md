# Codex review 02

The user and I both think rewrite 01 is good. Keep its voice, five-stage
architecture, and simplifying decisions as the base. This is an editorial pass,
not a request to reconsider the rewrite from scratch.

## Keep

- Detect-and-pause rather than ownership tokens, elections, demotion, or a
  distributed-lock analogue.
- One bounded ledger pass rather than stable-set convergence or repeated full
  scans.
- `done-when` and `excludes` as the persisted slice boundary that babysit reads.
- The narrower invocation, truthful lifecycle, durable chosen follow-ons, and
  proportionality checkpoint.
- The four progressively disclosed references and the deletion of
  `existing-claim.md`.
- The removal of trusted-author filtering. A public repository can have
  untrusted commenters, so the rationale should not say otherwise; the decision
  still holds because a spoofed marker causes a cheap, recoverable pause rather
  than crossing a meaningful security boundary.

## Three corrections

### 1. Give detect-and-pause a detection point

Two agents can currently read “no claim” in stage 2, both post in stage 3, and
then proceed without either being told to look again. After posting, read only
the target's claim comments once. If more than one active claim exists, pause
and show the collision to the user.

This is not a request for a post-claim tracker scan, election, token, tie-break,
or demotion protocol. It is the smallest read that makes the selected
detect-and-pause posture operational. At least the later publisher sees the
collision, stops before implementation, and gives the present user a cheap
recovery path.

### 2. Authorize the first direct-PR commit

The direct-PR bootstrap currently makes “the smallest coherent first commit”
before stage 4 establishes the finite slice boundary. That conflicts with the
skill's “before implementation” contract and with the new authorization gate.

On the direct-PR path, resolve stage 4's material implementation decisions and
finite boundary before the first commit. Then perform the pre-write overlap
read, create the branch and first commit, open the draft PR, and immediately
publish the already-resolved claim. Pre-creation questions are already exempt
from the identity gate; once the PR exists, stage 4 can take its zero-question
path.

Do not add an intermediate issue, empty ceremony commit, or second interview to
solve the ordering problem.

### 3. Handle a Project without an unambiguous lifecycle mapping

Stage 2 says to resolve `In Progress` and `Done`, but no longer says what happens
when an attached active Project lacks either option or represents lifecycle
differently. Add the small missing branch: ask the user how that Project
represents lifecycle and retain the answer as its status mapping. This makes the
stage completion condition attainable without silently dropping an attached
tracker.

## One optional wording change

In `references/interview.md`, “Interview relentlessly” pulls against the
rewrite's low-ceremony, finite-interview behavior and can encourage discovery of
more questions. Prefer a positive bound such as “Interview only about unresolved
material implementation decisions and their dependencies.” The following rules
already supply the necessary demand.

## Promotion and evals

Agree with deleting or re-anchoring the seven source-shape assertions rather
than restoring prose solely to satisfy them.

Agree that the old exhaustive post-claim reconstruction behavior must not
survive. Make its replacement concrete rather than using the broad action label
`overlap-evidence-labeled:honestly`: when a later ledger read differs, use the
newer state, report the difference, and never present the earlier evidence as a
fresh check. Rename and reshape the case around that behavior, retaining the
live provenance only insofar as it supports this narrower outcome.

These are surgical corrections. Please preserve everything else unless one of
them exposes a direct contradiction.
