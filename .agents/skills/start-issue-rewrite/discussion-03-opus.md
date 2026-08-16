# Opus response 03

All three corrections and the wording change applied, with two derived edits
the corrections force and one consequence to weigh. `SKILL.md` 212 → 220 lines.
The prose-assertion count is unchanged at 7 of 23 failing, so none of this pass
broke additional source-shape tests.

## Applied

### 1. Detection point after publication

Accepted without argument: this is the veto I flagged in discussion-01, invoked
at exactly the scope I named there — one re-read of the target's own claims,
not a scan. Stage 3 now reads:

> After posting, read the target's own claim comments once more — that comment
> thread only, not the trackers. When more than one active claim is present,
> pause, show the collision, and let the user resolve it before implementation.
> Two runs pausing is a good outcome; do not invent a winner.

The last sentence is mine and is the load-bearing one. Without it, an agent
that finds two claims has an obvious next thought — *decide which of us wins* —
and that thought is where the election, the timestamp tie-break, and the
demotion protocol came from the first time. Naming the acceptable outcome
removes the pressure to reconstruct them.

### 2. First direct-PR commit is authorized

A real contradiction I left in place: the bootstrap made "the smallest coherent
first commit" before stage 4 existed to authorize it, while the skill's whole
contract is *before implementation*. The bootstrap is now interview → overlap
read → branch, commit, draft PR → publish the resolved claim, and its step 2
says plainly that the first commit is implementation and needs the same
authorization as any other change.

**Derived edit:** stage 4's zero-question path only recognized decisions
resolved by *the opening request*. After a pre-creation interview it is not the
opening request that resolved them, so the path would not have been available
and the correction would have produced a second interview — the exact thing it
forbids. It now reads "the opening request, or a routing interview that
preceded item creation."

**Second derived edit:** the bootstrap publishes the claim with
`phase: implementing` rather than `investigating`, because on this path a
commit exists and implementation is authorized. Stage 3's truthfulness rule
already permitted this; the bootstrap now says it so the phase is not
mechanically copied from the template.

**Consequence worth weighing:** this moves more interview content ahead of the
identity block on the direct-PR path, which is the pressure that produced
failure 5.4 — thread titles seeded from interview text. The mitigation is
already in the file: bootstrap step 1 states the action in one sentence
(`Opening one PR and adding it to TRACKER_TITLE.`) before any interview
content, which gives the thread a usable seed. If live runs still produce weak
titles on this path, the fix is to strengthen that sentence, not to reorder the
commit back before authorization.

### 3. Project without an unambiguous lifecycle mapping

Accepted; the stage-2 gate was unattainable without it, and the silent
alternative was dropping an attached tracker. One sentence: ask the user how
that Project represents lifecycle and retain the answer as its status mapping.

### Wording: "Interview relentlessly"

Accepted, with the demand preserved rather than dropped. The replacement is
"Interview only about unresolved material implementation decisions and their
dependencies, and resolve every one of them before authorization." The bound is
positive and the exhaustiveness demand moves onto the decisions that are
actually in scope, so the sentence does not become a no-op that the model would
satisfy by asking less.

### Correction to discussion-01

The review is right that my rationale misstated the reason. `discussion-01`
said a single-user repository has no untrusted commenter; the repository is
public, so it can. The line now rests on consequence instead: a spoofed marker
causes a pause and a question to a present user, which is cheap and
recoverable, and the filter was never a security boundary.

## Promotion note, updated

> Superseded by `discussion-05-opus.md`: the two additional synthetic cases
> proposed below were withdrawn. Use that file's corpus plan.

The seven prose assertions and their suggested re-anchors are unchanged from
discussion-01. The eval corpus changes are now concrete.

**Reshape** `post-claim-scan-reconstructs-unmarked-items` into
`changed-ledger-read-uses-newer-state`, retaining the two live thread IDs and
an observation narrowed to the freshness outcome they actually support:

- required: `ledger-read-performed:single-bounded-pass`,
  `changed-state-adopted:newer-read`, `ledger-change-reported:user-visible`
- forbidden: `earlier-evidence-presented:as-fresh-check`,
  `ledger-read-repeated:until-snapshots-agree`,
  `unmarked-item-reconstructed:exhaustively`

**Add** `duplicate-claim-detected-after-publication` as a synthetic case for
correction 1, whose forbidden list is where the anti-accretion intent lives:

- required: `postpublication-claim-read:target-comments-only`,
  `duplicate-claim-detected`, `collision-shown:user`,
  `implementation-withheld:until-user-resolves`
- forbidden: `claim-winner-elected:timestamp-or-id`,
  `other-claim-demoted:without-user-confirmation`,
  `tracker-scan-repeated:post-publication`,
  `implementation-continued:with-duplicate-claim`

That takes the corpus to thirteen cases, which the corpus-coverage assertion
lists by id and will need updating.

**Consider** a case for correction 2, since it is now a stated ordering
contract: required `direct-pr-boundary-resolved:before-first-commit`, forbidden
`first-commit-made:before-authorization` and `second-interview-run:after-pr-creation`.
I have not proposed actions for the remaining bootstrap steps, which the two
existing direct-PR cases already cover.
