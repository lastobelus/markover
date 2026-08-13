# Live review metadata conformance

This program checks whether real agents turn Markover's machine-readable guidance
into truthful portable `review.agentThread` snapshots. The bounded structural
fixtures in `cases.json` remain contract tests; the matrix and evidence directory
record live product behavior.

## Workflow

1. Select an exact host/provider row from `matrix.json` and follow its exercise.
2. Keep the raw `get` artifact and capture observation under ignored `tmp/`.
3. Push the runner commit to the declared pull request, then run
   `npm run eval:metadata:record --` with those two inputs. The command verifies
   that the commit is in that PR's fetched head history and that the running
   recorder inputs match that commit, applies the shared v1 decoder and the
   rubric, verifies the immutable review content matches `exercise-source.md`,
   then writes a reduced record.
4. Inspect the reduced JSON, add its ID to the matrix row, and run
   `npm run eval:metadata:validate`.
5. Before declaring the matrix complete, run
   `npm run eval:metadata:validate -- --require-complete`.

The recorder creates its output exclusively and never overwrites an existing
file. Raw artifacts stay under `tmp/review-metadata/` and are never promoted.
Free-form observation limitations also stay in the ignored observation; the
committed record retains their structured discovery and runtime facts only.
The recorder requires a matching GitHub `origin` and read access to the
declared pull-request head ref so runner provenance cannot point elsewhere.
If a truthful artifact fails an automatic check, first create or link its
contract defect as a GitHub sub-issue descendant of #99, then rerun the same record command with
`--defect-issue NUMBER`. The recorder writes a closed failure record containing
only corpus identity, provenance, and the defect link; it omits the raw artifact,
runtime values, discovery details, and error text. A failed record cannot satisfy
`--require-complete` without at least one passing record for the same matrix row.
Recording and later corpus validation walk GitHub's bounded `parent` hierarchy,
require every issue to remain in the source PR repository, and fail unless the
chain reaches #99.

## Classification semantics

Issue #134 defines `threadHost.kind` as the user-facing product or lookup
namespace and `threadHost.provider` as the observed LLM provider or model family,
not an intermediate harness. Exact product labels and pairs in this corpus remain
observational evidence from their recorded runs. Add an exact row only when the
live thread makes both roles unambiguous; retain ambiguous future products as
host-only `expansionCandidates` with `discover-at-exercise`.

`agentThread.id` records the best observable requesting-thread or session ID. An
equal `threadHost.threadId` is valid, although agent guidance recommends omitting
it unless it is a distinct host-owned identifier.

```sh
npm run eval:metadata:record -- \
  --review tmp/review-metadata/raw-review.json \
  --observation tmp/review-metadata/observation.json \
  --output evals/review-metadata/evidence/EVIDENCE_ID.json
```

## Observation shape

Copy this template under ignored `tmp/review-metadata/` and fill only values
observed in the live run:

```json
{
  "schemaVersion": 1,
  "evidenceId": "2026-08-12__t3code-codex__1234abcd",
  "matrixEntryId": "t3code-codex",
  "exercisedAt": "2026-08-12T12:34:56.789Z",
  "sourceCommit": "REPLACE_WITH_FULL_GIT_COMMIT_SHA",
  "sourcePullRequest": "https://github.com/OWNER/REPOSITORY/pull/NUMBER",
  "runtime": {
    "hostVersion": null,
    "hostVersionSource": "not-exposed",
    "providerVersion": null,
    "providerVersionSource": "not-exposed",
    "providerModel": null,
    "providerModelSource": "not-exposed"
  },
  "discovery": {
    "providerThreadId": { "status": "observed", "source": "agent-runtime" },
    "hostKind": { "status": "observed", "source": "thread-context" },
    "hostProvider": { "status": "observed", "source": "thread-context" },
    "hostThreadId": { "status": "unavailable", "source": "not-exposed" },
    "machine": { "status": "observed", "source": "hostname-command" }
  },
  "truthfulnessAttested": true,
  "limitations": ["The thread host did not expose a product version."]
}
```

Allowed version sources are `command`, `runtime-context`, and `not-exposed`.
Non-null runtime values must be normalized version/model tokens: one to five
space-separated alphanumeric segments using only `.`, `_`, `+`, or `-` within
segments. Extract that token from command output; never copy paths, URLs, or
unparsed command output into an observation.
Allowed discovery sources are `agent-runtime`, `thread-context`,
`thread-host-runtime`, `hostname-command`, `not-exposed`, and `not-applicable`.

## Rerun triggers

Rerun an affected row when Markover's metadata guidance or validator changes, a
host or provider changes identity discovery, a product/model version changes
materially, a new host/provider combination becomes available, or an observed
snapshot drifts from the last committed evidence. Add a new immutable evidence
record; keep earlier records as history.

Expansion candidates name hosts only. Choose their LLM provider/model family
from the live thread at exercise time, then add an exact matrix row. This keeps
LastCode, direct provider hosts, OpenCode, Cursor, and future mixed combinations
visible without inventing LLM provider/model-family identity. Candidate context uses only the closed reason codes
`no-live-thread` and `provider-not-observed`; keep free-form notes outside the
committed corpus.

## Initial evidence

The 2026-08-12 baseline exercises all three initial rows. The original records
retain runner commit `82df4d6ecd95be511ede2ccb0113e126c46d416d` as history. Each
same-run raw artifact was re-recorded through hardened runner commit
`a5fec04fac192db4da3cafb73df38db8f112d626`, then through duplicate-aware,
PR-provenance-verifying runner commit
`1c56bdf7019c0573afe7ae0c0605a9938e336a98`, and finally through source-bound,
closed-corpus runner commits `e562535075a434f9554c535be835591f17025a7b`
and `9e1559d4df4f505d960782f17f64cf8724925520`, the latter binding the actual
build configuration too. Privacy- and containment-hardened runner commit
`0fce000ea82942ccdab87e7fc1bd80d9743903b0` produced the next records, followed
by private-token-segment-hardened runner commit
`ffbe48d1a3d7121d39c5958c9ba5a7f85c1649e0`, then ID-slug-bound runner commit
`159e8801c67478c9d35b7a7368809484dbc3d6d1`. Exercise-source-bound and
failure-retaining runner commit `20bdc87b121e6b141254b88aa8e9d5dbd978ab85`
produced the next records, followed by defect-ancestry-verifying runner commit
`30239c3cc1dc6e31b29a5491657fe14f7c97c86e`, then all-artifact-string privacy
runner commit `4347774bc7644631f5bf98a7d40e3e772f1a4bb5`, followed by extension-key
privacy runner commit `7266b46701d7cc0df21bc88f9f939f9aa32dab03`, then unified success/failure
privacy runner commit `8d3c0688d787db5f8bc444c3a8e5b71e607c7ecd`, followed by complete
exercise-input and ignored-observation binding in runner commit
`53f2ddfeaaa9b1a4732cd46f6f594a976c260c6e`, then evidence-date and
identifier-sized private-prose binding in runner commit
`e7c4a44cc633712b15d0f175d29969f244674e36`, followed by identifier-component
and failure-date validation in runner commit
`ae35722a27c600f2d5bc536d187a918554cb84ca`, then case-insensitive private-value
comparison in runner commit `8ecb62d86ae16a5d1e5e5736fc817fcb8a8cce1f`, followed by
punctuation-aware runtime containment in runner commit
`a5ab4abca2e11cf51e2a5e714fcbbaef777aafa7`, then numeric-leaf privacy in runner
commit `8d921e2eb2c85ebe211e7a3daddac31d563040b6`. All nineteen immutable
records per combination remain referenced by the matrix. After rebasing onto
the latest `main`, rebased head `4a077eceae1354a554868070204f1215b1269589`
produced a twentieth record for each combination. After stacking on #148, the
#134-aligned runner at `bc4d87cd121f0451ff9aac72d3c810c8653a5f76`
produced a twenty-first record for each combination. Delimiter-stripped
private-identifier comparison in runner commit
`584f85ced53c2b745c018fe6958975ceee04897a` produced a twenty-second record for
each combination after #148 merged. Short-component protection for explicitly
private paths and identifiers in runner commit
`806d09ae47a06ac03cae8e5c3b596cef68d9d4d7` produced a twenty-third record for
each combination. Stable runner-history archival and delimiter-stripped private
path-component comparison in runner commit
`db4f833003fb6d861401252602f2242f360a0896` produced a twenty-fourth record for
each combination. Shared explicit-private normalization for passing and failure
evidence in runner commit `10d7dbef69f48a1373ae77dd50047fe46fb89be7`
produced a twenty-fifth record for each combination. Short complete private-leaf
retention in runner commit `aae18de00aa03a4dacb783ceff222f7c092bb7ba`
produced a twenty-sixth record for each combination. Short safe-numeric private
leaf retention in runner commit `3eaccbd6bd62f40b5d37ed195c9bc64e0cd935a6`
produced a twenty-seventh record for each combination. Explicit attachment
path/URL normalization in runner commit
`f65c5d7e48596706aadfeb64ae608243539629ac` produced a twenty-eighth record for
each combination. Percent-decoded explicit-private candidate comparison in
runner commit `b9a0e1103c2b0f62a69a54f07dc70a34900f84f8` produced a twenty-ninth
record for each combination after the latest `main` integration. Embedded
explicit-private identifier comparison in runner commit
`32aeb2570a10a64c3cb24140055f6f894973af72` produced a thirtieth record for
each combination. Shared runtime and evidence-ID private-substring comparison
in runner commit `c80fe4967b26ca8a932d81e0e4dca7ed92712971` produced a thirty-first
record for each combination. Failure-path substring checks and decoded
complete-private inputs in runner commit
`e2c3ebf24b0c710f7f9930e9dbcb2aca94ca7c24` produced a thirty-second record
for each combination. Field-aware short-identifier containment in runner
commit `bc32ad96ca416bb590441de37533144f1947c5af` produced a thirty-third record
for each combination. Bidirectional private/runtime substring comparison in
runner commit `f5a05e7c96fec9e0821f00491855527ff62045f8` produced a thirty-fourth
record for each combination. Short explicitly private path-component
containment in runner commit `c979810ca3349f5d63840ab287e372d569b6c9c3`
produced a thirty-fifth record for each combination. Short-aware bidirectional
evidence-suffix containment in runner commit
`2c5d3397f92fcd21e0006a4cc522de8488378848` produced a thirty-sixth record for
each combination. Case-insensitive compound identifier-field recognition in
runner commit `b63246ecb27ac7190f4f94bfb5a9864c9024e99f` produced a thirty-seventh
record for each combination. Field-classified identifiers of every non-empty
length in runner commit `82ea8205e05944f1f8046e247381c7bd8a8c91d8`
produced a thirty-eighth record for each combination. Canonical safe-integer
identifier comparison in runner commit
`1e6d7e8a3a1ed35608431445c1f8065979d201a8` produced a thirty-ninth record for
each combination. Short identifier component and complete-private numeric
normalization in runner commit `5ce4f8a7a35ebfac43746b0539ae83fa91a511e2`
produced a fortieth record for each combination.
Radix-form safe-integer identity comparison in runner commit
`6fedd0b7a24616639c55b21f83812d51a93e9c96` produced a forty-first record for
each combination.
Short additive-key containment in runner commit
`93a39dc903a53aa0480aed4fea733f6afddcdc36` produced a forty-second record for
each combination.
Identifier-field propagation through nested values in runner commit
`856ecd62cf13fd54eebc9fa1aac95ed7b2e79d08` produced a forty-third record for
each combination.
Short additive scalar containment in runner commit
`07b89385a3c20840c7091b1c1bed3ecf46476005` produced a forty-fourth record for
each combination.
All-length additive string containment in runner commit
`9b23cf885ff01e0fb62e035c0ca127ae23690bae` produced a forty-fifth record for
each combination.
Canonical numeric suffix and separator normalization in runner commit
`bc7055502ef553b40b012aa22bc99a5d7ad411ec` produced a forty-sixth record for
each combination.
Numeric multi-token segment canonicalization in runner commit
`9904e88283135d55d7870970cb99cb98c482fe57` produced a forty-seventh record for
each combination.
All-length machine identity containment and version-prefixed numeric
canonicalization in runner commit
`f5896c8001438cf01cc660e0d95bf7168874d165` produced a forty-eighth record for
each combination.
All-length additive safe-numeric containment in runner commit
`dedc7394a973bda3bccc45a7fea033f34d63a9f7` produced a forty-ninth record for
each combination.
Node-type-aware additive-field classification in runner commit
`0d3a7c2ef32e9ff094454a3a65b7b38c57e30438` produced a fiftieth record for
each combination.
Normalized runtime forward-containment comparison in runner commit
`c19a04670007024eabf2435935f54431b5cdc3b9` produced a fifty-first record for
each combination.
Arbitrary-precision integer identity canonicalization in runner commit
`7be84c064aa0d51f32d3d734606234413c45b73f` produced a fifty-second record for
each combination.
Complete version-prefix stripping for numeric identities in runner commit
`ffba3af929902bdd5054a927d640690c60d009b3` produced a fifty-third record for
each combination.
Bounded percent decoding to stability in runner commit
`b7b5cc143ce517e4a2f3adaf7fca75728b45c799` produced a fifty-fourth record for
each combination.
Normalized short-candidate containment in runner commit
`72d7d133bf6c12f351abb08164c8064bfe67a0e5` produced a fifty-fifth record for
each combination.
Signed radix identity canonicalization in runner commit
`72ad81f6c5ddc5c3df57e3fcb5b3eef192f00d75` produced a fifty-sixth record for
each combination.
Split-token numeric identity canonicalization in runner commit
`894af016bb99cd7dfe6ba978691614df7263f551` produced a fifty-seventh record for
each combination.
Punctuation-stripped numeric identity canonicalization in runner commit
`13a19119285a7ed26d45b8c0e84b5a7bb7f38f3b` produced a fifty-eighth record for
each combination.
Public-schema candidate filtering and fractional numeric identity
canonicalization in runner commit `0acfce4b895c755c4b1c5ffa0f0901cbf5363aca`
produced a fifty-ninth record for each combination.
Percent-decoded numeric identity canonicalization in runner commit
`5d706d6085e655d5fc8f370d84e5a4635a3f0056` produced a sixtieth record for each
combination.
Runtime-scoped embedded numeric identity extraction in runner commit
`2166b2ba2f77e8d06c60b557cd95d264d735787c` produced a sixty-first record for
each combination.
Ambiguous embedded-radix rejection in runner commit
`27fe1ec7e8565b79d5a238c51784461f4e9b349b` produced a sixty-second record for
each combination.
Embedded radix-prefix identity comparison in runner commit
`bd157ef7e54acae9aeacfd5faab8923efee5fc51` produced a sixty-third record for
each combination.
Overlapping embedded numeric-literal extraction in runner commit
`3dfb39fc9afa582db3263535e2cfefe81c6a03e1` produced a sixty-fourth record for
each combination.
Embedded radix-body subrange comparison in runner commit
`542415721709289aa6e0f5bfe53d18d3482af853` produced a sixty-fifth record for
each combination.
Embedded evidence-suffix numeric comparison in runner commit
`e40b166789ad5a945805584a9129d6e537ca7dee` produced a sixty-sixth record for
each combination. These records use the independent suffix `qzvkmjxh` because
the runner-derived suffix itself contained a rejected embedded numeric value.
Fixed-width unprefixed hexadecimal identity comparison in runner commit
`bf0e5ffbf935dbe39d6263959345eef037b01794` produced a sixty-seventh record for
each combination, using independent suffix `wqzvmjkh`.
Symmetric digit-only fixed-width hexadecimal comparison in runner commit
`a5cc48325822384d776d037d4ce620bc03aa64d9` produced a sixty-eighth record for
each combination, using independent suffix `xqzvmjkh`.
Complete unprefixed hexadecimal comparison and embedded 64-character window
support in runner commit `d4b728afbff0fafad01d20cc611f88cfad361345`
produced a sixty-ninth record for each combination, using independent suffix
`yqzvmjkh`.
Every-width embedded hexadecimal comparison in runner commit
`b9ffcec2b6829533b346e15eeea24f9e2d2e5f53` produced a seventieth record for
each combination, using independent suffix `zqvwmjkh`.
Scientific exponent-prefix comparison in runner commit
`aca65339312abe915b776eeea38415074e896307` produced a seventy-first record for
each combination, using independent suffix `vqzwmjkh`.
Short unprefixed hexadecimal comparison in runner commit
`7c4e1aa36de041db8949ccc92989733c40ff88bc` produced a seventy-second record for
each combination, using independent suffix `rqzvmjkh`.
Private-identifier numeric-component and exercise-directory provenance
comparison in runner commit `9f1995eabcc9ef01128ab9afc022e90d7f0adc9c`
produced a seventy-third record for each combination, using independent suffix
`nqzvmjkh`.
Canonical Base64 and Base64url private-value comparison in runner commit
`bf95592d2f61a8f65037e788ccc2838e18e188a6` produced a seventy-fourth record for
each combination, using independent suffix `pqzvmjkh`.
Base64 decoding-depth fail-closed comparison in runner commit
`e265f9b7c7c966efb5dd6b79cdd52a5e1baf0191` produced a seventy-fifth record for
each combination, using independent suffix `tqzvmjkh`.
Symmetric reversible-decoding and untracked-provenance comparison in runner
commit `cf6bb6d1d891d0dda4be32c240cd3c991505eccf` produced a seventy-sixth record
for each combination, using independent suffix `uqzvmjkh`.
Canonical Base32 and ignored-provenance comparison in runner commit
`6bf78f42d2280798841eb0ed12067d21b9d40e01` produced a seventy-seventh record
for each combination, using independent suffix `gqzvmjkh`.
Canonical UTF-8 hexadecimal and transitive CLI-source comparison in runner
commit `8572a54536f2770f36cb635dab88258c1be5203e` produced a seventy-eighth record
for each combination, using independent suffix `fqzvmjkh`.
Bounded base-36 numeric identity comparison in runner commit
`0c47889d2bcfa63eac4bde225f6bf58fb8e82dec` produced a seventy-ninth record for
each combination, using independent suffix `lqzvmjkh`.
Alphabetic-leading base-36 identity comparison in runner commit
`b9aefec7d9877dff1178b98ebb07671bebaafc0c` produced an eightieth record for
each combination, using independent suffix `oqzvmjkh`.
Full runtime-token-width base-36 identity comparison in runner commit
`2c6faa2e06d66297bb09a6eb0b7641e6903e38d7` produced an eighty-first record for
each combination, using independent suffix `hqzvmjkh`.
Canonical Base58btc private-value comparison in runner commit
`3ca18fc86f70aa7985fdd7c9aa58c2355b40c1f3` produced an eighty-second record for
each combination, using independent suffix `jqzvmjkh`.
Supported multibase-wrapper comparison in runner commit
`83bce54c6d38e2667e20c40ab202f937625f8903` produced an eighty-third record for
each combination, using independent suffix `kqzvmjkh`.
Short unpadded Base64 and additive-scalar base-36 comparison in runner commit
`11ae91b788a8ed5d0759131b5997ab46cf0505d9` produced an eighty-fourth record for
each combination, using independent suffix `sqzvmjkh`.
Canonical Base32hex and short reversible-encoding comparison in runner commit
`dabd7f6494a9540dbedb13275674a8b1c132d754` produced an eighty-fifth record for
each combination, using independent suffix `eqzvmjkh`.
Multibase Base36 comparison in runner commit
`12566c8b3e3bbed6d7e79d5e4ee5c27de96a07a2` produced an eighty-sixth record for
each combination, using independent suffix `dqzvmjkh`.
Numeric multibase comparison in runner commit
`17494eeb0cc6ed441775146ed97c133b927dc764` produced an eighty-seventh record for
each combination, using independent suffix `cqzvmjkh`.
Multibase binary comparison in runner commit
`d6c13f6a30fd00962ca45afb1a008def9451972c` produced an eighty-eighth record for
each combination, using independent suffix `aqzvmjkh`.
Multibase Base32z comparison in runner commit
`d15de37ce945acfcfe47102abd23d832bdd87212` produced an eighty-ninth record for
each combination, using independent suffix `bqzvmjkh`.
Multibase Base58flickr comparison in runner commit
`c86595b8e1cd5109337ed788fc7476e98e9100a2` produced a ninetieth record for
each combination, using independent suffix `mqzvmjkh`.
Encoded runtime-envelope comparison in runner commit
`e63015f8c263bec3d2767704769dba083d6064d2` produced a ninety-first record for
each combination, using independent suffix `iqzvmjkh`.
Multibase Base45 and short additive-key comparison in runner commit
`bdd4bd1265237fce42614feab1194fc527941d0d` produced a ninety-second record for
each combination, using independent suffix `qqzvmjkh`.
ASCII85 private-value comparison in runner commit
`6d3f476b73dec5c97712b9d652f3e097e52b29dd` produced a ninety-third record for
each combination, using independent suffix `rqzvnjkh`.
Unprefixed Base45 and Adobe-framed ASCII85 comparison in runner commit
`0e19ba58157bba22c33370c2ecc909c691b6b25a` produced a ninety-fourth record for
each combination, using independent suffix `tqzvnjkh`.
Punycode private-value and historical PR-provenance comparison in runner commit
`f4829e619dac04f44fdae0d0abe886c90b0eb3f3` produced a ninety-fifth record for
each combination, using independent suffix `uqzvnjkh`.
Padded multibase Base32 comparison in runner commit
`d4528b595b615d37f36bc64c454247eb14a09f35` produced a ninety-sixth record for
each combination, using independent suffix `vqzvnjkh`.
Multibase Proquint comparison in runner commit
`0ed99b550e74e96eb72bb7150658d6506db79a74` produced a ninety-seventh record
for each combination, using independent suffix `xqzvnjkh`.
Unprefixed Proquint comparison in runner commit
`87a1d65c9c16b3628f334fef91721a9c4c7664aa` produced a ninety-eighth record
for each combination, using independent suffix `yqzvnjkh`.
Segmented runtime reversible-decoding comparison in runner commit
`8c0d65850caf778d775f48f017630f0de492c735` produced a ninety-ninth record for
each combination, using independent suffix `zqzvnjkh`.
Decoded-only segmented runtime comparison in runner commit
`1d0f331872d69f6bf3d10955e9d65a9874705eb6` produced a one-hundredth record
for each combination, using independent suffix `1qzvnjkh`.
Runtime-token-filtered segmented decoding in runner commit
`245bb0ca5c0b151ce9a55bb1ce31b5915012f995` produced a one-hundred-first record
for each combination, using independent suffix `2qzvnjkh`.
Decoded-segment recombination in runner commit
`7954de37444e59f84d0aa7fb09ae5a9b546f7d0e` produced a one-hundred-second
record for each combination, using independent suffix `3qzvnjkh`.
Multi-segment decoded-alternative comparison in runner commit
`41157fabc46600a204eb7239bb3f724b2ef432f2` produced a one-hundred-third record
for each combination, using independent suffix `4qzvnjkh`.
Whitespace-separated Adobe ASCII85 comparison in runner commit
`987384535f5255faff7d920dcf9bd94fa24838d8` produced a one-hundred-fourth
record for each combination, using independent suffix `5qzvnjkh`.
Canonical Z85 comparison in runner commit
`fa92e485e7c8a3f0eb49a7762ad655670107344a` produced a one-hundred-fifth record
for each combination, using independent suffix `6qzvnjkh`.
Short complete-private value containment in runner commit
`b356681bfb405f8c7ae871d96d1ce1eb8009cc88` produced a one-hundred-sixth record
for each combination, using independent suffix `7qzvnjkh`.
Canonical Base62 comparison in runner commit
`c66221955ac72c53c91e7997fd370ee492539102` produced a one-hundred-seventh
record for each combination, using independent suffix `8qzvnjkh`.
Whitespace-folded Base64 comparison in runner commit
`e3701fa68cdf378098b989d8d06f3925b5581f85` produced a one-hundred-eighth
record for each combination, using independent suffix `9qzvnjkh`.
Quoted-printable comparison in runner commit
`85feb53c8311526280f55dd31e9601c5d2629cbc` produced a one-hundred-ninth record
for each combination, using independent suffix `aqzvnjki`.
HTML numeric character-reference comparison in runner commit
`dce9e4c241e94b56dc03118c14943631a1644665` produced a one-hundred-tenth record
for each combination, using independent suffix `bqzvnjki`.
Canonical uuencoding comparison in runner commit
`fd60c2134bd14f6657a17f1065d6e113a47c2fbb` produced a one-hundred-eleventh
record for each combination, using independent suffix `cqzvnjki`.
Semicolonless numeric-reference and backtick-padded uuencoding comparison in
runner commit `c0decdc4d353d7e8ef27f30470369e12a77355ff` produced a
one-hundred-twelfth record for each combination, using independent suffix
`dqzvnjki`.

`sourcePullRequest` identifies the recording PR. Its rewritten historical
runner commits are retained under the versioned immutable
`issue-136-runner-history-v96` tag, so a clean checkout can inspect any recorded
runner with:

```sh
git fetch origin refs/tags/issue-136-runner-history-v96
git show SOURCE_COMMIT:scripts/review-metadata-conformance.ts
```

| Combination | Runtime evidence | Result |
| --- | --- | --- |
| T3 Code × Codex | `gpt-5.6-sol`; T3 Code and provider versions not exposed | Pass |
| T3 Code × Claude | `claude-sonnet-5`; Claude Agent SDK 0.3.227; T3 Code version not exposed | Pass |
| Claude Code × Claude | Claude Code 2.1.228; `claude-sonnet-5`; provider service version not exposed | Pass |

Each record retains structured discovery limitations, ID relationships, and
typed redaction markers. No raw requesting-thread ID, host ID, hostname,
session path, free-form observation text, or account data is committed.
