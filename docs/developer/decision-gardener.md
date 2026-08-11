# Local decision-register gardener

The decision gardener reconciles landed `main` behavior with `DECISIONS.md`.
It is a trusted maintainer tool, not a GitHub-hosted agent or a general CI
runner. A missed invocation is harmless: every run fetches `origin/main` and
audits the complete range after the durable checkpoint in `DECISIONS.md`.

## Manual invocation

Start from a clean Markover checkout at current `origin/main`, with the local
`gh` and `codex` CLIs already authenticated. The Codex login uses the
maintainer's existing local ChatGPT/Codex subscription; do not provide an
OpenAI API key.

```sh
npm ci
npm --silent run decision-gardener -- --model gpt-5.6-sol
```

The explicit model must be available to the local Codex account. To use a
different available model, replace only the `--model` value. The command fails
before fetching or creating a worktree when the source checkout has tracked or
untracked changes. After fetching, it also refuses to continue unless the
source `HEAD` is the fetched `origin/main`, ensuring that the trusted wrapper
itself is current.

## Trust boundaries

The wrapper performs three separated phases:

1. The trusted host fetches `origin/main` and uses read-only `gh repo view` and
   `gh api` calls to snapshot every open issue and pull request plus trusted
   `start-issue` work-intent comments. The versioned snapshot is bounded and
   becomes immutable agent input. Issue, comment, commit, patch, and file text
   is explicitly treated as untrusted evidence rather than agent instruction.
2. The wrapper creates a detached, clean worktree at the fetched commit and
   runs `codex exec` there. Codex receives the immutable Git bundle and
   ownership snapshot through stdin. It is ephemeral, read-only,
   approval-disabled, shell-disabled, web-disabled, app-disabled,
   subagent-disabled, and isolated from repository instructions and GitHub or
   API-key environment variables. This follows the safety controls available
   in [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
3. Only after the Codex process exits does a separate publisher process regain
   the trusted host environment. It revalidates the result, proposal hashes,
   audited base, clean worktree, and exact one-file diff. It may then commit
   `DECISIONS.md`, push a new `decision-gardener/...` branch, and open a draft
   pull request. It never pushes `main`, merges, closes issues, changes launch
   gates, or creates follow-up issues.

An existing open pull request carrying the decision-gardener publication
marker blocks another run before Codex starts. The publisher repeats that
check immediately before it creates the branch, closing the normal discovery
race on the trusted host.

## Outcomes

The command prints one JSON object:

- `published` includes the draft pull request, publication commit, branch, and
  durable run directory.
- `ambiguous` means the supplied evidence cannot support a safe register
  change. Nothing is committed or pushed; inspect the durable report.
- `no_changes` means no unaudited landed commits remain after recognized
  checkpoint-only publications are excluded.
- `blocked` identifies the unresolved gardener pull request that must be
  reviewed before another proposal is generated.

A complete audit always proposes the full `DECISIONS.md` and advances its one
checkpoint, even when no semantic register entry changes. The publisher
rejects unknown result fields, stale ownership matches, empty classification
evidence, changed unclassified entries, reordered existing entries, a wrong
checkpoint, dirty input, untracked files, or any diff outside
`DECISIONS.md`.

## Durable artifacts and recovery

Runs are stored by default under:

```text
~/Library/Application Support/Markover/Decision Gardener/runs/<run-id>/
```

Each run preserves the ownership snapshot, immutable audit bundle and hashes,
per-round agent results, final structured result, proposed `DECISIONS.md`,
draft pull-request body, publication manifest, outcome or failure record, and
the isolated worktree. These files may contain repository and issue content;
keep the directory private and do not copy local Codex authentication files
into it.

If publication fails after the local commit or push, do not delete or rerun the
artifacts blindly. Inspect `failure.json`, the preserved worktree, the remote
`decision-gardener/...` branch, and any draft pull request. Resolve or remove
that exact partial publication deliberately before starting another run. The
gardener never force-pushes or overwrites an existing branch.

Use `--run-store <absolute-path>` only when the trusted host needs a different
durable private location. Intel-host cadence, notifications, health records,
and automated recovery belong to the later host-operations slice of issue
[#101](https://github.com/lastobelus/markover/issues/101).
