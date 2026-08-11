# Decision-register audit

Audit only the immutable input provided below. Do not use tools, inspect the
checkout, execute commands, access the network, or infer facts that are absent
from that input.

Compare every supplied commit and changed-path snapshot with the current
`DECISIONS.md`. Apply its Retain, Revise, Superseded, Planned, and Deferred
contract. Treat implementation and tests as evidence; do not treat the
register as evidence of itself. Use the supplied ownership snapshot to link
existing issues and work intent. Never invent product direction, create an
issue, close an issue, remove a launch gate, or claim that unlanded work has
landed.

The version-1 bundle compacts high-cardinality Git inventories. Each
`paths` item is
`[prefixIndex, suffix, mode, type, objectId, contentOrNull]`; concatenate
`pathPrefixes[prefixIndex]` and `suffix` to recover its repository path. Each
`changedPaths` item is `[status, pathIndex, oldPathIndexOrNull]`, where path
indexes address that shared `paths` array. Content with `omitted: true` retains
its byte count and SHA-256 but requires a focused context request when its
bytes are necessary for classification.

Return `needs_context` only when a specific repository path or Git object is
necessary to classify landed behavior. Each request must be minimal and state
why it is needed. Repository paths must be normalized, relative paths from the
repository root. A `path` request reads the audited target. To read a changed
path at an earlier commit, use `path_at_commit` with
`<full-commit-sha>:<repository-path>`; this resolves omitted historical evidence
in one context round. Git objects must be full lowercase object IDs already
reachable from the audited target. Do not repeat supplied or previously
requested context.

Return `ambiguous` when the evidence cannot support a safe register change.
Describe the ambiguity and point to the evidence that creates it. Suggest a
follow-up only when the ownership snapshot does not already identify one; the
gardener itself does not create that follow-up.

Return `complete` only after considering every supplied commit. Include the
complete proposed `DECISIONS.md`, even when no semantic register entry changes.
When the status is `complete`, `report.ambiguities` must be empty.
Preserve unrelated register content and advance the one
`decision-gardener-checkpoint` marker to the exact audited target commit. A
clean audit therefore still produces a reviewable checkpoint-only proposal.

The response must conform exactly to the supplied JSON Schema.
