# Thread-host and LLM-provider classification

Issue: [#134](https://github.com/lastobelus/markover/issues/134)
Coordinates with: [#131](https://github.com/lastobelus/markover/issues/131), [#136](https://github.com/lastobelus/markover/issues/136), and [#97](https://github.com/lastobelus/markover/issues/97)
Status: authorized for implementation

## Outcome

Markover records two separate, truthful facts about an agent-originated review:

- `threadHost.kind` identifies the user-facing product or lookup namespace where
  the user would look for the requesting thread.
- `threadHost.provider` identifies the LLM provider or model family the agent can
  truthfully report, rather than an intermediate harness, transport, or API
  compatibility layer.

Agents receive recommended values for common products, not a closed vocabulary.
Portable values remain nonblank open strings. Markover preserves the reported
values for storage and user-facing text, and uses role-scoped aliases only to
resolve presentation assets.

## General principle

Agent guidance recommends the clearest normal shape. Evals measure whether
agents usually produce that shape. The portable contract rejects unsafe or
unusable data, not harmless truthful variation, and downstream consumers do not
promote recommendations into brittle invariants.

This distinction is important for thread IDs. Guidance continues to recommend a
`threadHost.threadId` only when it is a distinct host-owned identifier. The
portable decoder, CLI, conformance evals, and private enrichment nevertheless
accept and correctly handle equal `agentThread.id` and `threadHost.threadId`
values.

## Portable field semantics

| Field | Meaning | Identity role |
| --- | --- | --- |
| `agentThread.id` | Best observable ID for the requesting thread or session. It is not assumed to be provider-owned. | Fallback thread ID when no host-owned ID is supplied. |
| `agentThread.threadHost.kind` | User-facing product or lookup namespace where the user would look for the thread. | Always participates in stable shared-thread identity. |
| `agentThread.threadHost.provider` | Truthfully reported LLM provider or model family. It is not an intermediate agent harness. | Presentation and classification only; never participates in stable identity. |
| `agentThread.threadHost.threadId` | Optional best observable host-owned thread ID. Guidance recommends supplying it only when distinct from `agentThread.id`, but equality remains valid input. | Preferred thread ID whenever present. |
| `agentThread.threadHost.machine` | Optional descriptive hostname snapshot. | Never stable or identity-bearing. |

No portable `runtime` or `harness` field is added. The user needs to know where
to find the thread and which model family they were talking to; an intermediate
harness does not improve correlation enough to justify another field.

The stable shared-thread identity consumed by #131 and #97 is:

```text
effectiveThreadId =
  agentThread.threadHost.threadId  when present
  agentThread.id                   otherwise

stableThreadIdentity = [agentThread.threadHost.kind, effectiveThreadId]
```

Provider, machine, aliases, runtime details, titles, and discovery paths never
participate. If the two IDs are equal, either branch produces the same identity.

## Recommended product matrix

These rows guide agents when they match observable facts. They are not an
allowlist, and Markover does not reject or rewrite other truthful values.

| User-facing product | Recommended `threadHost.kind` | Representative `threadHost.provider` |
| --- | --- | --- |
| T3 Code | `t3code` | Observed model family, such as `codex`, `openai`, or `claude` |
| LastCode | `lastcode` | Observed model family |
| Codex app or CLI | `codex` | `codex` or `openai`, matching what the agent reports |
| Claude Code | `claude-code` | `claude`, or another truthfully observed model family |
| OpenCode | `opencode` | Observed model family |
| Cursor | `cursor` | Observed model family |
| Gemini CLI | `gemini-cli` | `gemini` or `google`, matching what the agent reports |
| Kimi Code | `kimi-code` | `kimi` or `moonshot`, matching what the agent reports |

Forks and distributions use distinct host kinds when they are distinct
user-facing places to find a thread. Multiple surfaces share a kind only when
they expose the same discoverable thread namespace; otherwise the recommended
kind is surface-qualified.

Representative mixed cases:

```yaml
# T3 Code, Claude harness, ChatGPT-sol/Codex-family model
agentThread:
  id: "best-observed-requesting-session-id"
  threadHost:
    kind: t3code
    provider: codex # or openai, matching the agent's evidence

# Direct Claude Code using Claude
agentThread:
  id: "best-observed-requesting-session-id"
  threadHost:
    kind: claude-code
    provider: claude

# Kimi model used through Claude Code
agentThread:
  id: "best-observed-requesting-session-id"
  threadHost:
    kind: claude-code
    provider: kimi # or moonshot, matching the agent's evidence
```

## Registry semantics

Thread-host and provider registrations are separate role-scoped registries.
Each registration has a stable canonical key, explicit aliases, and a stable
artwork key. Canonical keys and aliases are UI metadata; they never replace a
portable value or enter the shared-thread identity.

Lookup keeps the current forgiving normalization: trim, lowercase, and remove
non-alphanumeric separator runs. For example, `T3 Code`, `t3-code`, `t3_code`,
and `t3.code` all resolve through the lookup key `t3code`. Lookup does not use
prefix or semantic guessing.

Every normalized alias resolves to at most one registration inside its role
registry. A collision across different registrations is a registry validation
error caught by focused tests. The same normalized alias may exist once in each
role registry because the roles are independent.

Provider alias examples may map `codex` and `openai` to shared artwork,
`claude` and `anthropic` to shared artwork, `gemini` and `google` to shared
artwork, and `kimi` and `moonshot` to shared artwork. The raw reported label
remains visible in text and accessibility output.

An unknown value remains valid and visible. Its role badge uses a short initials
fallback derived from the raw value. Empty values remain invalid under the
portable nonblank-string contract.

## Inbox and Projects projection

The UI implementation remains separate from #134 and belongs to #97 or a
focused #97 follow-up:

- Keep the provider badge in its current lower-right overlap on the project
  icon.
- Add the thread-host badge at the lower-left when it supplies a visually
  different mark.
- Move both badges down slightly so they obscure less of the project icon.
- Remove the current hover-to-swap presentation; both distinct marks are
  directly visible.
- Suppress the thread-host badge when its resolved artwork or fallback visual
  is identical to the provider badge, even if the raw labels differ.
- Keep both raw role labels in tooltip and accessibility text when a duplicate
  badge is suppressed.
- When only one role resolves to registered artwork, show an initials fallback
  for the other role. When neither resolves, show distinct initials fallbacks
  unless their displayed visuals are identical.
- Keep the existing Local Markdown treatment for `agentThread: null`.

Cross-role duplicate suppression compares the stable resolved artwork key, not
raw strings or object identity. This lets `codex` and `openai` preserve distinct
reported text while avoiding duplicate-looking badges.

## Current and proposed agent guidance

The current machine-readable help says:

> For agent-originated reviews, provide truthful thread metadata when
> observable: `--thread-id` is the provider thread ID;
> `--thread-host-kind` is the application containing the thread;
> `--thread-host-provider` is the provider serving it;
> `--thread-host-thread-id` is only a distinct host-owned ID; and
> `--thread-host-machine` should use the local hostname result when available.
> Omit unavailable values rather than guessing.

Replace it with:

> For agent-originated reviews, provide truthful thread metadata when
> observable: `--thread-id` is the best observable requesting-thread or session
> ID; `--thread-host-kind` is the user-facing product or lookup namespace where
> the user would look for the thread; `--thread-host-provider` is the LLM
> provider or model family in use, not an intermediate harness;
> `--thread-host-thread-id` is only a distinct host-owned ID; and
> `--thread-host-machine` should use the local hostname result when available.
> Use recommended product values when they match observable facts, preserve
> truthful unknown values, and omit unavailable values rather than guessing.

Structured machine-readable field guidance and example JSON are deferred to
[#146](https://github.com/lastobelus/markover/issues/146). That discovery will
evaluate whether structure improves conformance without duplicating the
portable schema, drifting from command usage, or accidentally introducing a
second JSON-based CLI input path. #134 retains concise prose and the existing
flag interface.

The `open` usage changes only its descriptive placeholders:

```text
open <markdown-path> --summary <text>
  [--thread-id <thread-or-session-id> | --handoff-key <key>]
  [--thread-host-kind <kind>
   --thread-host-provider <llm-provider-or-model-family>
   [--thread-host-thread-id <distinct-host-id>]
   [--thread-host-machine <hostname>]]
```

The distinct-host-ID phrase remains concise guidance. It is removed as a
runtime rejection and as a portable decoder invariant.

## #134 implementation boundary

Despite the issue's original discovery-only boundary, the interview explicitly
requires one narrow correction in #134 because portable v1 has not shipped in a
release and current runtime behavior contradicts the agreed tolerant contract.
The #134 pull request should contain:

1. This standalone classification specification.
2. The `review-handoff-format.md` corrections for `agentThread.id`, provider
   semantics, and equal-ID acceptance.
3. The machine-readable help wording and usage placeholders above.
4. Removal of duplicate-ID rejection from `src/review-format.ts` and
   `scripts/markover.ts`.
5. Focused decoder, CLI, and help-payload tests proving equal IDs are accepted
   while distinct-or-omitted remains the recommended agent output.

It does not add icon assets, renderer/CSS changes, enrichment storage,
integrations, polling, watchers, provider APIs, a runtime field, or structured
JSON guidance. No compatibility reader, migration, or schema-version bump is
added because this
corrects unreleased portable-v1 semantics before the first release containing
that schema.

## Coordination and dependency order

The reviewable slices land in this order:

1. **#134 contract and classification, base `main`.** Land the semantic source
   of truth and narrow equality correction first.
2. **#131 private enrichment, based on #134 while reviewed.** Replace “host ID
   when present and distinct” with “host ID when present”; keep provider out of
   the key. #131 consumes the classification and does not author agent guidance.
3. **#136 conformance, based on #134 while reviewed.** PR #141 currently embeds
   the old provider-owned and inequality assumptions. Update its rubric,
   exercises, matrix interpretation, and tests; retain immutable prior evidence
   as history and record new evidence when the changed guidance triggers a
   rerun. #136 evaluates guidance and does not author it.
4. **#97 UI projection, based on landed #134.** Implement the lower-left host
   badge, lower-right provider badge, duplicate-artwork suppression, fallback
   visuals, and provider-independent grouping fallback.

#131 and #136 are sibling follow-ons once #134 lands; neither depends on the
other. #97 may implement the visual slice independently, but shared private
thread enrichment consumption waits for #131.

## Focused validation matrix

| Case | Required result | Owner |
| --- | --- | --- |
| Equal `agentThread.id` and `threadHost.threadId` | Portable decoder and `open` accept it. | #134 |
| Distinct host ID | Accepted and preferred for stable identity. | #134 contract; #131/#97 consumers |
| Host ID omitted | `agentThread.id` is the fallback. | #134 contract; #131/#97 consumers |
| Provider changes for one host thread | Stable shared-thread key does not change. | #131/#97 |
| Unknown host/provider strings | Accepted, preserved, and rendered with raw-label fallbacks. | #134 contract; #97 UI |
| Alias punctuation/case variants | Resolve to one role-scoped registration without rewriting raw values. | #97 registry implementation |
| Same-role alias collision | Registry validation fails deterministically. | #97 registry implementation |
| Same alias across roles | Each role resolves independently. | #97 registry implementation |
| Same resolved artwork across roles | Only provider badge is drawn; both labels remain accessible. | #97 UI |
| T3 Code through Claude harness using Codex-family model | Guidance and eval evidence report `t3code` plus `codex` or `openai`, not `claude` merely because of the harness. | #136 |

The user confirmed this wrap-up and authorized the #134 implementation slice.
