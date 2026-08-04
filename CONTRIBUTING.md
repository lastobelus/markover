# Contributing to Markover

Thanks for helping improve Markover. Bug reports, scoped proposals,
documentation improvements, tests, and code contributions are welcome.

Markover is maintained on a best-effort basis. Response times vary, and opening
an issue or pull request does not guarantee that a change will be accepted.

## Choose the right starting point

- Report a reproducible defect with the bug-report issue form.
- Ask usage questions and share early ideas in
  [GitHub Discussions](https://github.com/lastobelus/markover/discussions).
- Turn an idea into a scoped proposal issue only after discussing it.
- Report suspected vulnerabilities through
  [GitHub private vulnerability reporting](https://github.com/lastobelus/markover/security/advisories/new),
  never in a public issue or Discussion.

Search existing Issues and Discussions before starting a new thread. For
nontrivial implementation work, comment with your intended approach and wait
for maintainer confirmation so effort is not duplicated.

Prior agreement is required for new features, user-facing behavior changes,
architecture changes, protocol or persisted-data changes, and substantial UI
redesigns. Clearly scoped bug fixes, tests, and documentation corrections may
proceed directly.

## Set up a development checkout

Markover development requires Node.js 22.13.0 or newer, npm, and macOS for
running or packaging the desktop application.

```sh
npm install
npm start
```

See [Developing Markover](docs/development.md) for storage paths, packaging,
release details, and the complete repository map. Read [DECISIONS.md](DECISIONS.md)
before changing established behavior or data boundaries.

## Validate changes

Before submitting a pull request, run:

```sh
npm run check
npm test
```

Add focused automated coverage for changed behavior. User-facing and packaging
changes also need relevant manual validation on macOS. If a check cannot be
performed, say exactly which check was omitted and why in the pull request.

Use the committed `.editorconfig` and ESLint configuration. Keep changes
focused; avoid unrelated formatting or refactoring.

## Respect the architecture boundaries

- The Electron main process owns filesystem access, native integration, review
  persistence, and the loopback service.
- The renderer runs with context isolation and no Node integration. Extend the
  narrow preload bridge instead of importing Node or Electron into renderer
  code.
- The public bootstrap CLI in `packages/cli/` remains dependency-free. On
  success, agent-facing commands write exactly one JSON value to stdout;
  diagnostics and failures go to stderr.
- Reviewed source content and its checksum are immutable. Source edits are
  proposals and must not rewrite the review target or its structural IDs.
- Managed-review state changes must preserve the existing atomic and
  idempotent handoff behavior.

Markover currently has no external user base. Before MVP0, prefer a clean break
for protocol, storage, feature, and architecture changes. Do not add fallback
readers, dual writers, migrations, or other compatibility layers unless there
is concrete evidence of active external use and the maintainer agrees to the
migration policy first.

Preserve historical review JSON and attachments unless deletion is explicitly
in scope. The latest app does not need to open every older artifact: retained
JSON remains available for analysis, and an older app version can be used for
occasional viewing. Do not add migrations solely to make historical reviews
openable by the latest version.

Application restarts must not require draining or handing off every inflight
review. Coordinate a planned restart so an active CLI request is not cut off,
then rely on persisted managed-review state. Crash/restart bounded-loss
durability belongs to issue 39 rather than the local-service authorization
work.

## Submit a pull request

A useful pull request:

1. Links the relevant issue or Discussion.
2. Explains the outcome and the boundaries of the change.
3. Includes tests and documentation appropriate to the behavior.
4. Reports automated and manual validation honestly.
5. Includes before-and-after screenshots for meaningful visual changes.

Maintainers may ask for a pull request to be narrowed, revised, or closed when
it conflicts with project direction or maintenance capacity.

## Licensing and generated work

By submitting a contribution, you agree to license it under the repository's
[MIT License](LICENSE). Markover does not require a contributor license
agreement, Developer Certificate of Origin, or signed-off commits.

AI-assistance disclosure is not required. You remain responsible for
understanding, reviewing, testing, and having the right to submit everything in
your contribution, regardless of the tools used to produce it.

When adding or updating a production dependency, explain why it is needed,
review its license, run `npm run notices:generate`, and commit the updated
`THIRD_PARTY_NOTICES.md`. Notice generation must not silently omit a shipped
dependency.
