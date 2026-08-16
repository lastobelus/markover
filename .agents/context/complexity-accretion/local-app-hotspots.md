# Longer-term local-app simplification

Read `README.md` first. This thread prioritizes and investigates one hotspot at
a time. It is not authorization for a broad refactor or a mandate to execute
the audit as a backlog.

Authoritative report:
`doc/explanations/2026-08-13__complexity-accretion-audit/03-local-app-hotspots.html`

## Ranked findings

1. **Private enrichment — severe excess, highest confidence.** A database-like
   lifecycle protects stale or missing secondary labels before any producer or
   consumer exists. Its first action belongs to the issue #97 sequence in
   `markover-now.md`: remove the unused runtime while preserving bytes and real
   privacy boundaries, then build one proven T3 vertical.
2. **Shutdown — valid primary-durability goal, faulty cancellation model.** A
   `Promise.race` deadline does not cancel underlying work, so admissions can
   resume while late mutations continue. Investigate later as a standalone
   primary-durability slice; do not fold it into enrichment deletion.
3. **Settings — strong excess, with a supported offline edit path.** Issue #159
   confirmed one production `SettingsStore` writer per state root and one
   read-only CLI consumer. Advanced users may edit `autosaveMaximumDelayMs`, but
   the documented contract requires quitting Markover first and restarting it
   afterward. Startup validation, atomic replacement, and malformed fallback
   remain real controls; cross-process symlink locks, PID liveness, stale
   reaping, repeated acquisition, and live watching protect unsupported
   concurrent writers. Keep the in-process queue because renderer changes and
   native zoom commands can overlap inside the one Electron owner.
4. **Attachment cleanup — coordination too broad.** Exact revalidation is sound,
   but scanning and the confirmation dialog need not freeze every managed
   mutation. A target-review lane plus immediate revalidation and skipped
   changed candidates is the candidate smaller boundary.
5. **Local service publication — core security justified.** Loopback binding,
   authentication, and live identity checks protect a real boundary. Only the
   two-record convergence/repair topology is questionable; treat cautiously.
6. **Autosave — primary data merits protection.** The current exact timing and
   recovery protocol may be larger than necessary. Candidate shape: one
   in-flight save, one latest pending snapshot, trailing debounce, explicit
   flush, visible persistent failure, and retry on edit or explicit action.
7. **Project provenance — decorative data fails closed.** A source path can be a
   display/discovery hint; exact checksum identity belongs to overwrite,
   execution, or exact-source claims rather than labels and favicons.
8. **Portable private-name embargo — brittle but released.** Version 1 creates
   real compatibility obligations. Do not simplify this casually or as part of
   an unrelated slice.
9. **Workspace state — durable retry for disposable layout.** Forgiving known
   fields, atomic latest-state replacement, and reset on malformed data are the
   likely smaller shape. It should not be quit-critical.
10. **Development cleanup — cautious and low priority.** Destructive code earns
    care. Keep canonical-target, symlink, realpath, and running-instance checks;
    reassess cross-device Trash emulation only after higher-value work.

## Controls grounded in supported use

Preserve the single application owner, per-review serialization, exact handoff
snapshot, atomic primary writes, bytes-before-references attachment ordering,
renderer isolation, privileged IPC checks, and authenticated localhost
requests. These protect real user data or trust boundaries.

## Working order

1. Coordinate private-enrichment simplification with the short-term issue #97
   thread; do not create a competing plan or implementation branch here.
2. Settings topology investigation #159 is complete against `main` at
   `47a1cc62`; it changed #144's premise that cross-process settings locking
   should remain independently testable. PR #161 merged as `67db642b` and
   completed the subsequently authorized bounded slice: settings lock, watcher,
   and per-update disk-reread states are gone; the loaded store's in-process
   queue, validation, atomic replacement, restart-loaded offline edits, and
   malformed-file recovery remain. Focused tests, `npm run ci:local`, GitHub CI,
   and a zero-finding automated review passed. #144's acceptance criteria now
   preserve this supported topology instead of requiring settings cross-process
   locking. The settings hotspot is complete at this boundary. Shutdown remains
   more consequential and deserves a separate durability investigation.
3. Investigate the chosen hotspot read-only first. Name supported reachability,
   consequence, recovery, states removed, real controls retained, and finite
   completion evidence.
4. Start implementation only with explicit authorization and one bounded work
   item. Finish or defer it before selecting another hotspot.

A hotspot is ready to propose when its smaller behavior can be stated without
a replacement framework, migration for unreleased state, compatibility layer,
generic registry, new retry system, or expansion into adjacent coordinators.
