# LastCode and workflow tooling

Read `README.md` first. This thread plans and, when authorized, builds workflow
support in the user's LastCode/T3Code fork. Complexity avoidance is a product
requirement, not a cleanup phase after a generic orchestration system exists.

## Desired workflow

A thread should be able to start a real process, yield without consuming turns,
and receive a resume event when the process completes or needs input. The human
should not have to poll or relay completion messages. This is needed for CI,
development loops, reviews, and other tools that currently tempt agents into
sleep/check/sleep turn churn.

The goal supports 1–2 heavier LastCode sessions alongside 3–5 Markover
sessions. It should reduce idle-turn waste without imposing a global scheduler
or making every tool asynchronous.

## Near-term product friction

- Canonical Markover is often broken or behind when needed for actual work.
- T3Code does not conveniently hand `markover:` URLs to macOS, so moving from an
  agent thread to the selected review is annoying.
- Existing harnesses make the human the message bus when a process finishes.

The canonical-health and review-opening problems are small possible wins and do
not need to wait for process wakeups.

## MCP Tasks context

The current MCP specification is 2026-07-28. Tasks graduated from the
experimental core into the `io.modelcontextprotocol/tasks` extension. The
extension defines durable task handles, `working`, `input_required`, terminal
states, cancellation, and client opt-in during capability negotiation. Polling
with `tasks/get` remains the default. Push now uses `notifications/tasks` over
`subscriptions/listen`; the older `notifications/tasks/status` shape is stale.

Current host support is not established. The MCP client matrix omits Tasks, the
extension repository still labels itself experimental despite the release and
specification saying it graduated, Anthropic describes a rollout without a
product-specific Tasks support guarantee, and OpenAI's current Codex MCP page
does not advertise Tasks or extension negotiation. LastCode's own MCP server is
preview-only and pins MCP `2025-06-18`.

Sources:

- https://modelcontextprotocol.io/extensions/tasks/overview
- https://modelcontextprotocol.io/extensions/client-matrix
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://github.com/modelcontextprotocol/ext-tasks
- https://claude.com/blog/bringing-mcp-2026-07-28-to-claude
- https://learn.chatgpt.com/docs/extend/mcp

Use MCP Tasks as a later compatibility target. The first local tracer should
not depend on host support or implement the whole extension.

## Verified LastCode checkout and host

Read-only inspection on 2026-08-13 located the fork at
`/Users/lasto/projects/lastCode`, with origin `lastobelus/lastCode` and upstream
`pingdotgg/t3code`. The inspected clean worktree is
`/Users/lasto/.t3/worktrees/lastCode/t3code-f9cab453`. Live LastCode sessions
changed its branch and commit during read-only inspection. Resolve current Git
state and create or select an implementation worktree before editing; this note
is not a Git-state cache.

`LastCode.app` is installed but was not running during inspection. The active
host was `T3 Code (Nightly).app`, so a tracer implemented only in the fork must
be built and launched explicitly before live QA.

## Verified seams

- The event store and projections persist canonical LastCode thread and turn
  state. `provider_session_runtime` separately persists the provider binding,
  runtime payload, and Codex resume cursor.
- Each Codex session owns a `codex app-server` child. Recovery starts a new
  adapter session with the persisted provider thread ID, and a new turn is sent
  with Codex `turn/start`. This resumes a provider conversation, not a process
  wait.
- `thread.turn.start` is the only normal new-turn command. Its contract requires
  a user-role message, and the decider persists that message. There is no
  production command or event for a process-completion wakeup.
- The provider-command reactor consumes a hot in-memory event stream. Its own
  source notes that pending work from before reactor startup cannot be resumed.
  Production runtime receipts are intentionally a no-op; their PubSub form is
  test-only.
- `ProcessRunner` collects output and waits for process exit inside the caller's
  effect. It is not a detached process handle.
- The terminal manager is the closest existing signal seam. It owns
  thread-scoped PTYs, saves terminal history, and emits an exit event with exit
  code and signal. Live process ownership is in memory, so a server restart is a
  missed-wakeup boundary for an initial tracer.
- Provider approval and user-input callbacks are also in memory. Persisted UI
  rows survive, but recovered sessions reject stale responses and instruct the
  user to restart the turn.

The missing bridge is therefore narrow but real: preserve the originating
LastCode thread ID with one running operation, then translate one terminal or
review signal into one new provider turn without pretending the signal was a
human message.

## Tracer definition

A **tracer** is a deliberately narrow, real end-to-end implementation that
crosses the production seams needed to answer one risky question. It is an
implementation path intended to remain useful, not a mock, design exercise, or
throwaway spike. Its exemplar is specific so its completion test is finite; it
does not generalize adjacent cases until the exemplar proves the seam.

The question for this tracer is: can one agent-started process let its current
turn end, consume no polling turns while it runs, and cause exactly one
addressed follow-up turn when it exits, without making the user relay the
result?

The Quick CI tracer is complete only when a real configured action runs in a
real LastCode-hosted terminal, the originating turn ends before the action
finishes, no turn is consumed while waiting, one exit result wakes the same
thread once, unrelated terminals do not wake it, and the initial restart limit
has documented manual recovery. Configuration, launch, correlation, signal,
wake, and a truthful visible result are inside the tracer. General tasks,
durable scheduling, arbitrary commands, readiness signals, and Markover input
are outside it.

## Selected tracer: Quick-CI exit

The user selected Quick CI on 2026-08-14. Configure it as an **Action**, the UI
name for the internal project-script model. Run it in one dedicated
thread-scoped PTY whose shell is replaced by the command, return an arming
receipt immediately, and resume the same thread once with trusted structured
exit metadata. Do not automatically place terminal output in the resumed
turn.

Verified configuration and trigger seams:

- persisted project settings already contain named scripts; checked-in
  `t3.json` scripts are importable rather than an automatic live overlay;
- the T3 MCP credential already authenticates the calling provider session and
  carries its LastCode thread ID;
- the terminal manager emits exit, error, close, and activity events keyed by
  thread and terminal; and
- Codex can start a new turn on the resumed provider thread, while LastCode
  still needs a truthful internal source for that automated turn.

Thread resume requires an explicit, fail-closed opt-in even for this tracer.
The chosen home is a local per-Action setting, default off, such as **Allow this
Action to resume agent threads**. A checked-in or imported `t3.json` must not be
able to grant the permission. The setting only makes the Action eligible; an
agent must still invoke the dedicated resume-capable tool. Clicking the Action
in the UI or running the command in an ordinary terminal does not arm a wake.

Gate the wake on both a terminal result and an idle thread so a fast process
cannot turn its own tool call into steering. The automated provider input should
be fixed LastCode-authored control text containing only server-generated IDs and
validated enums/numbers. Display it as machine activity rather than a human
message. `thread.turn.start` as-is records a human user message, so the exact
internal turn-start representation still needs to be chosen before
implementation.

An **arming receipt** is the structured acknowledgement that LastCode has
validated the Action opt-in, installed a one-shot correlation from the
server-generated run ID to the originating thread and turn, attached the
terminal listener before launch, and accepted the command. `armed` describes
the wake registration, not whether the process is still running. The receipt is
not a poll token. It should state that first-cut durability lasts only for the
current LastCode process.

A **bounded output artifact** is a managed file containing the final
size-limited suffix of process output after terminal control sequences are
removed, accompanied by byte, line, and truncation metadata. Store it under
LastCode application data in a server-generated thread/run directory rather
than an OS temporary directory. The wake contains status, exit code or signal,
duration, run ID, and the artifact descriptor, but no output text or generic
last-line preview. The resumed agent chooses how much of the completed file to
read; that read is not process polling and the contents remain untrusted data.

The current Action terminal uses a PTY and exposes one combined output stream;
stdout and stderr cannot be separated after capture. Separate artifacts would
require a runner that pipes and tees both child streams back into the PTY. Keep
one combined artifact for the smallest first cut unless separate streams are
chosen as worth that extra seam.

LastCode archive is reversible, and existing persistent terminal history is
cleaned up on permanent thread deletion rather than archive. The user proposed
retaining Action output until archive and accepted retaining it through archive
and deleting it on `thread.deleted`, so unarchiving does not produce a thread
with missing diagnostic evidence.

Retention needs a later user-facing cleanup control because threads may remain
archived indefinitely. Keep it outside the tracer. Prefer a LastCode Settings
command that reports eligible artifact count and size and explicitly cleans
completed artifacts for archived threads. An optional automatic retention
policy can follow, default off. Cleanup must exclude running Actions and pending
wakes and disclose that an unarchived thread will no longer have those logs.

The completion test is one locally opted-in configured command, one yielded
turn, one addressed terminal result, and one follow-up turn. A server restart
may terminate the PTY and lose the wake registration in the first cut; the
arming receipt must say so, and terminal history plus manual user resume is the
initial recovery. Durable Action execution across a full LastCode restart is a
required second cut. Its finite test is that the process continues across the
restart, a completion during or after downtime is recovered, and the same
thread wakes exactly once. Choosing persistent process ownership and wake
delivery for that cut is separate design work subject to the complexity
tripwire. Development readiness and Markover feedback remain later tracers,
not parts of this slice.

## Boundary for a first vertical

The first implementation should prove only:

- one thread starts one known process;
- the thread yields without polling turns;
- one completion or input-required event addresses that thread;
- the harness resumes it once with the process result; and
- restart/cancellation behavior is stated honestly, even if initially limited.

Use the process or existing thread store as the source of truth where possible.
Before evidence requires more, leave out a general task database, distributed
leases, multi-host ownership, durable notification retry, provenance history,
provider-neutral adapter registry, arbitrary process adoption, and exactly-once
delivery proof. A missed wakeup with a visible completed process is recoverable;
the first vertical may use detection and manual recovery.

## Durable work item

The feature request is
[`lastobelus/lastCode#13`](https://github.com/lastobelus/lastCode/issues/13),
**Allow opted-in Actions to resume agent threads when they finish**. It is an
open `enhancement` in the user-owned
[`LastCode Integrations` Project #10](https://github.com/users/lastobelus/projects/10)
with status `Todo`. It owns the Quick-CI tracer, restart-durable second cut, and
artifact-retention controls. It is scheduled work with no active implementation
claim.

## Completion for the planning thread

Planning is complete when the configuration source, invocation trigger, and
automated-turn representation are chosen; reachable failures and recovery are
explicit; and the smallest change is described without a speculative
orchestration framework. Begin implementation only after explicit user
authorization.
