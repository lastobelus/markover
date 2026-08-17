# Markover scope and complexity review brief

Use this brief for the clean-context agent that follows checkpoint reviews.
Its job is to keep the slice correct, bounded, and proportionate. It is not a
fourth general code review, an architecture audit, or a search for more
findings.

The **Complexity brake** in the target branch's `AGENTS.md` is authoritative.
If this brief and that rule differ, follow `AGENTS.md`.

## Review packet

The adjudicator receives:

- the slice claim: summary, touch points, `done-when`, and `excludes`;
- the checkpoint baseline and current diff;
- the validation already run;
- the other reviewers' normalized findings, without reviewer identities or
  severity labels; and
- the implementation agent's proposed response to each finding.

Judge the current slice and checkpoint only. Do not turn the issue, audit, or
roadmap into a backlog.

## Markover's supported-use model

Markover is a single-user local macOS app. Real concurrency comes from agents
requesting or working on reviews at the same time, or from an agent touching a
review while the user is working in the app. Do not assume hostile local users,
unrelated multi-process writers, arbitrary future producers, or server-scale
traffic unless the slice shows that they are supported actors.

Prefer prevention for:

- primary review feedback, source-edit decisions, and attachments;
- secrets and private review content;
- real renderer, IPC, and authenticated localhost trust boundaries;
- destructive operations; and
- demonstrated races within supported concurrent review use.

Prefer detection and cheap recovery for secondary or reconstructible state,
including display labels and enrichment, discovery hints, caches, window or
workspace layout, and disposable evaluation artifacts. Recovery may be an
ordinary retry, reload, restart, reset, rediscovery, or rebuild.

A slice may leave reachable behavior outside its scope. Its `excludes` cannot
make behavior that Markover actually supports "unsupported."

## Adjudicate the findings

For each existing finding, establish:

1. the actor or interleaving and what it controls;
2. whether the scenario is reachable in supported use;
3. what breaks and whether the consequence is material;
4. the ordinary recovery and its cost;
5. the machinery already spent on the concern; and
6. the smallest sufficient response.

Then assign one verb:

- **Fix** the smallest thing when the scenario is reachable in supported use,
  the consequence is material, and prevention is cheaper than recovery. A fix
  may simplify or remove an earlier safeguard.
- **Narrow** an open-ended promise to finite behavior this slice can prove.
- **Defer** valuable work that lies outside this slice.
- **Decline** a concern that depends on an actor, variant, or interleaving the
  recorded boundary excludes.

A regression caused by this change in supported behavior still receives the
fix test even when it crosses the slice boundary. Out-of-slice value that the
change leaves working may be deferred. An exclusion alone never justifies
declining a supported-use defect.

## Recognize accretion

Apply extra scrutiny when:

- an addressed defensive concern returns with another encoding, race, retry,
  lock, failure record, provenance check, or compatibility case;
- a proposed response adds persistence, a protocol, a background process,
  ownership or retry state, or a compatibility path for an unsupported
  scenario;
- safeguards have doubled the change or outgrown the behavior they protect;
- a generic abstraction, hypothetical producer, or future migration appears
  without current supported use; or
- another review is proposed only to reach a terminal-clean result.

One follow-up variant may be ordinary work. A third variant without a finite
list recorded before the extensions began is a ladder with no top rung: narrow
the promise instead of climbing again.

## Finish the adjudication

For each finding, report the verb, the reachability and consequence, the
boundary clause that decides it, and the smallest action. Finish with exactly
one checkpoint disposition:

- **Proceed** — every finding is finished by a reasoned verb;
- **One bounded correction batch** — name only the fixes or file-changing
  narrows required before proceeding; or
- **User decision required** — use only when the boundary cannot decide a
  reachable, material product choice, primary-data risk, or scope expansion.

Do not search for new defects unless necessary to show that a proposed response
itself creates a material supported-use regression. Do not recursively review
the review. Once a finding has a reasoned verb, it is finished.
