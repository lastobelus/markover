# Shared context after the complexity-accretion audit

Read this file and the file for the thread's thrust. They replace inherited
conversation history when starting a new thread or after context compaction.
The source reports remain authoritative for detail; these files preserve the
decisions and user context that are easy to lose.

When a material decision or current state changes, update that thrust's file in
place. Replace stale text; do not append a session journal.

## Thread split

- This existing thread keeps the skills rewrite.
- `markover-now.md` starts the short-term Markover thread.
- `local-app-hotspots.md` starts the longer-term simplification thread.
- `lastcode-tooling.md` starts the LastCode and workflow-tooling thread.

## User goals and operating constraints

- Markover must remain personally useful. Announcement-roadmap work should not
  displace the tweaks and features that improve daily use.
- The desired public finish is modest: announce on GitHub and Hacker News,
  handle likely modest attention, then treat Markover as mostly done except for
  personally important work, fixes, and contributed PRs.
- The project also exists to learn open-source development and rebuild a
  professional network after not working since 2019.
- Complexity accretion is a recurring problem across projects. The working
  method must notice a blackhole early and escape it.
- Sustainable capacity is about 4–5 hours per day and 25 hours per week.
- The user likes tooling and stays engaged with parallel work: normally 1–2
  heavier LastCode sessions and 3–5 Markover sessions. Fewer than four active
  sessions creates distracting idle time.
- At genuine choice points, offer 2–3 valuable alternatives rather than one
  prescribed backlog.
- Current daily pain includes a canonical Markover instance that is often stale
  or broken, and T3Code's awkward handling of `markover:` review links.

## What the blackhole established

Issue #136 / PR #141 asked for a finite metadata-conformance baseline with no
application code. Repeated automated review silently widened a bounded privacy
claim into protection against arbitrary representations of private input.

At its high-water mark the PR had about 29,105 inserted lines, 351 fixtures,
254 commits, and 160 findings. A clean rebuild preserved the useful result in
1,292 lines and three fixtures. Review still grew that rebuild to 1,757 lines
through 17 findings, 10 reviews, and nine follow-up commits before merge. The
final artifact was reasonable; the path remained too expensive.

The mechanism was consistent:

1. an open-ended property had no finite domain or completion evidence;
2. review severity was treated as authority;
3. each safeguard created new codecs, states, provenance, retries, or cleanup;
4. terminal-clean review replaced the issue's acceptance criteria;
5. cheap recovery and insignificant consequences were ignored.

The reset succeeded when the agent removed speculative provenance and declined
coincidental-ID and adversarial-symlink hardening. The intended habit is
proportional judgment, not universal rejection of defensive code.

## Boundary used by every thrust

Protect primary review feedback, attachments, secrets, real renderer/IPC
boundaries, destructive operations, and the real concurrency where an agent and
user can touch the same review. Prefer fallback, rediscovery, reset, or ordinary
retry for secondary, reconstructible, or disposable state.

The canonical tripwire is in `AGENTS.md`. It pauses work when a later finding
extends an already-addressed defensive concern, unsupported machinery appears
for an unproven scenario, or safeguards outgrow the behavior they protect.
Before continuing, establish:

- the reachable actor or interleaving;
- the material consequence;
- the ordinary recovery;
- the complexity already introduced;
- the smallest alternative; and
- finite evidence that ends the slice.

## Durable sources

- Audit overview:
  `doc/explanations/2026-08-13__complexity-accretion-audit/index.html`
- PR #141 forensics:
  `doc/explanations/2026-08-13__complexity-accretion-audit/01-pr-141-forensics.html`
- Guidance failure:
  `doc/explanations/2026-08-13__complexity-accretion-audit/02-guidance-loop.html`
- Local-app hotspots:
  `doc/explanations/2026-08-13__complexity-accretion-audit/03-local-app-hotspots.html`
- Tooling/process hotspots:
  `doc/explanations/2026-08-13__complexity-accretion-audit/04-tooling-process-hotspots.html`
- Start-issue research:
  `.agents/skills/start-issue-rewrite/rewrite-context.md`
- Revised issue #97 path:
  `doc/plans/2026-08-13__issue-97-enrichment-simplification-path.md`

## Session and branch recovery

The current multiply-compacted T3 thread is
`a6c280a5-d479-4a07-9233-065e765da6f2`. The original #136 blackhole thread is
`4e6fb032-a168-459f-b704-a3d034b82961`. Their persisted messages are in
`/Users/lasto/.t3/userdata/state.sqlite`; original provider logs also live under
`/Users/lasto/.t3/userdata/logs/provider/`.

This directory lives in the worktree for draft PR #151, branch
`agent/archive-complexity-accretion-audit`. PR #151 is a dormant evidence and
process archive, not an implementation checklist or announcement dependency.
Product recommendations leave it as standalone PRs.

Snapshot date: 2026-08-13 PDT. Recheck live PR and branch state before acting.
