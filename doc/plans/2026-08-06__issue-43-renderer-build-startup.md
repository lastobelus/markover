# Issue #43: Renderer build, startup, and packaged verification

## Outcome

Markover development and packaged applications run from one explicit `build/app/` stage whose browser renderer is a self-contained ESM bundle. No renderer dependency is resolved from `node_modules` at runtime, no generated vendor scripts or compatibility symlinks remain, and every build verifies the staged layout before it can launch or package.

Startup becomes an observable readiness protocol rather than an optimistic page load. Development launches show coarse internal phases, packaged launches remain generic, the CLI service is published only after restoration and listeners are ready, and failures leave a small sanitized diagnostic. Automated smoke exercises the real bundled renderer in development and signed packages without exposing a general debugging surface.

## Boundaries and dependent work

Issue #43 owns the renderer module graph, renderer bundling, staged application layout, first-paint script and CSP baseline, readiness phases, startup diagnostics, the constrained smoke self-test, and build/package verification.

It does not own Electron sandboxing, navigation and permission denial, broad IPC hardening, or fuses; issue #6 consumes the CSP and bridge baseline. It retains `loadFile()` and the `file:` renderer origin so issue #52 exclusively owns `markover://review/<review-id>` registration and routing. It establishes readiness and restoration boundaries that #52 can consume without implementing deep links.

PR #61 consumes only `build/app/` as the stable application launch/staging root, the logical staging and verification interfaces, emitted startup and brand assets, and readiness/service-publication behavior. Paths beneath `build/app/` are private. The development launcher forwards additional arguments and inherited environment variables unchanged except for the mandatory removal of `ELECTRON_RUN_AS_NODE`; #43 does not implement PR identity, alternate data roots, branding, or URL schemes.

Issue #62 owns the later decomposition of the renderer coordinator into feature modules. Issue #43 converts existing helper boundaries to explicit imports and exports and extracts only what startup separation or behavioral testing requires.

## Checkpoint 1: explicit application artifact

Replace the repository-root packaging model with an allow-listed generated application rooted at `build/app/`. The clean internal layout uses `build/app/src/` for main, preload, renderer, HTML, CSS, startup script, and directly referenced first-paint assets. A generated minimal `package.json` points at `src/main.js`. Both `npm start` and macOS packaging consume this same root.

TypeScript continues to compile main, preload, build scripts, tests, and local runtime modules. Only the browser renderer graph is bundled. Use esbuild's JavaScript API to emit one unminified, non-split ESM `renderer.js`, an external self-contained source map, and metadata outside the stage. Main and preload remain TypeScript compiler outputs and their explicit runtime closure is copied into the stage.

Convert the existing browser helper scripts from ambient globals and CommonJS fallbacks to explicit modules. Import `markdown-it`, `yaml`, `@pierre/trees`, `@pierre/diffs`, Preact, and their transitive browser dependencies into the renderer graph. Move browser libraries to `devDependencies`; the staged application and ASAR contain no renderer `node_modules`. Remove the import map, runtime `../node_modules` URLs, `src/vendor`, `build:vendor`, and the postinstall vendor build.

Generate third-party notices from packages actually shipped in the renderer bundle, including transitive packages that are marked development-only in the lockfile. Build tools that are not shipped remain excluded.

Generate a deterministic technical build identity containing package version, Git commit when available, dirty state, and renderer-bundle hash. Do not include a branch, PR number, username, checkout path, or build timestamp. Store the identity in the build metadata, startup diagnostic, and smoke result, not the normal release UI.

Every build runs an emitted-layout verifier before launch, test, or package. The verifier checks the exact allow-list, HTML/CSP references, startup and brand assets, the absence of runtime `node_modules` and vendor paths, source-map presence, and the generated package entry point. Packaging inspects the final ASAR against the same contract. Artifact sizes are reported but do not have a hard threshold.

## Checkpoint 2: startup and readiness

Extract the inline theme bootstrap into a dependency-free `startup.js` loaded before CSS. It accepts only validated palette, appearance, and colorization values, applies first-paint attributes, installs early `error` and `unhandledrejection` listeners, and reveals a generic “Still starting” state with a **Quit Markover** action after 30 seconds. It contains no review, storage, or general instance configuration.

Add the initial bundle-compatible CSP in the file-loaded HTML using a meta element. Scripts are strict and external. Styles allow the narrow inline-style exception required by dynamic CSS and Pierre shadow styles. Issue #6 may strengthen the policy later without replacing the build boundary.

Require the real preload bridge and validate one current bridge shape; do not negotiate versions or retain the implicit standalone-browser fallback. Tests install an explicit typed fake bridge. Electron preload failures and early renderer exceptions produce the same startup failure path.

Implement stable coarse phases: preparing interface, loading settings, loading brand, restoring reviews, restoring workspace, publishing service, and ready. Development stages show phase names; packaged applications derive generic presentation solely from `app.isPackaged`. Both modes retain detailed phases and timings in diagnostics and smoke output.

Readiness is two-stage. The renderer first restores settings, brand fallback, valid managed reviews, selected workspace state, and all listeners, then reports renderer initialization. Main starts and atomically publishes the local service, reports application readiness back to the renderer, and only then dismisses the startup screen. The managed document list is required before renderer readiness; the brand theme may fall back to emitted canonical SVGs without failing startup.

Load failures are isolated where safe. A malformed settings file is preserved and defaults are used; an unreadable settings directory is fatal. Individual malformed or incompatible reviews are preserved and skipped; inability to access the review store is fatal. One aggregated non-modal warning reports user-actionable review or settings recovery after readiness and links to the diagnostic. Cosmetic brand fallback remains diagnostic-only.

Maintain one private, restricted-permission startup diagnostic in application data. Replace it at launch and atomically update it when phases begin and finish. Successful startup records success and clears stale failure state. Fatal renderer termination after readiness replaces it with the crash event; issue #43 does not add post-startup hang timers, recovery, or restart.

Diagnostics contain version/build identity, platform and architecture, phases and timings, fixed failure categories, and sanitized stacks. They never contain capability tokens, review content, annotations, clipboard data, or arbitrary environment data. Normalize local paths to `~`, `<app>`, and `<temp>` while retaining useful filenames and line numbers. Failure dialogs offer copy/reveal/quit without Retry. Diagnostic UI remains contextual rather than permanent.

The development-only arguments `--dev-hold-startup=<known-phase>` and `--dev-fail-startup=<known-phase>` make stalled and fatal states reproducible. They accept only the fixed phase enum, do not accept custom timing or error input, and are unavailable to packaged launches and smoke.

Change CLI service startup from the current ineffective two-launch/10-second path to one launch and a 30-second readiness wait. On timeout, report the startup diagnostic path and leave the visible app available for inspection or user quit. Do not parse the diagnostic as a CLI control protocol.

## Checkpoint 3: behavior and live verification

Replace renderer source-text assertions with behavioral or emitted-artifact tests. Test modules through typed fakes and DOM fixtures, cover every supported palette/appearance/colorization combination with fast tests, exercise phase transitions and the 30-second state with fake timers, and verify fatal/recoverable diagnostic policies without relying on implementation strings.

Add a fixed `--smoke` self-test retained in release builds. It always uses fresh temporary state, skips protocol registration and external integrations, loads one built-in deterministic managed review, performs only display and selection, and emits one predefined result through the preload boundary. It accepts no fixture path, arbitrary command, DOM query, script evaluation, debug port, or network server.

The representative smoke proves functional Markdown rendering, YAML-backed structure, the Pierre documents list, and a source diff before main writes one JSON result and exits. The BrowserWindow is hidden and non-activating. Uncaught errors, rejected promises, CSP violations, failed resources, `console.error`, user-actionable startup warnings, or missing required checks fail smoke. Other warnings are retained as evidence but do not automatically fail.

The external runner owns the deadline and cleanup. Local smoke defaults to 10 seconds with no retry. Hosted and release workflows explicitly opt into 60 seconds with no retry. On failure, copy only the sanitized diagnostic, result/timeout record, stdout/stderr, and layout manifest to ignored `tmp/smoke-failures/`; hosted CI uploads this small bundle for seven days. Successful runs retain nothing.

Add `npm run ci:local` as the documented pre-PR gate. It performs one clean build, then static/notices checks, compiled Node tests, and local renderer smoke against that same stage. Keep focused standalone commands available. `npm start` performs only clean build, mandatory layout verification, and visible development launch.

Run Node/static/layout coverage in the existing Node matrix, but launch Electron/Xvfb only once at the minimum supported Node version. Do not run native macOS packaging on each PR. Release packaging continues on Apple Silicon and Intel; every `npm run package:mac` verifies the final ASAR and runs hidden smoke against the signed application before succeeding. The release workflow uses that same command before archiving and publication.

## Definition of done

- `npm start` launches the staged development app without a symlink, import map, copied dependency tree, or runtime browser `node_modules` URL.
- First-paint brand assets load, valid managed reviews restore, document selection works, and snapshot/status listeners answer CLI operations before the service is published.
- Development startup exposes stable phases; packaged startup remains generic; 30-second Quit, synthetic hold/failure, recovery warnings, fatal diagnostics, and post-ready renderer termination follow the agreed behavior.
- Behavioral, artifact, smoke, and package tests cover the original regression and the new readiness contract.
- `npm run ci:local`, `npm run check`, `npm test`, development smoke, and native macOS package verification pass as applicable.
- CI runs one hosted live renderer smoke without multiplying the Node matrix, and release packaging gates both macOS architectures on final-artifact smoke.
- Documentation, PR validation guidance, third-party notices, issue #43 acceptance criteria, and cross-issue ownership notes match the implemented contracts.

## Future concerns and revisit signals

### Richer smoke communication

Keep the one-result child-process protocol until concurrent smoke sessions share output, logs become ambiguous across processes, live per-phase remote monitoring is required, or a controller cannot rely on direct child stdout and exit status. Only then consider nonces, streaming events, or a stronger controller protocol.

### Watch mode and automatic restart

Track this as a concrete deferred, contribution-welcome issue after the deferred-contributions process exists. Revisit when repeated one-shot rebuild/restart cycles materially slow feature work. Coordinate with PR #61 runtime-instance resolution and persisted-review restart behavior rather than adding an independent staging path.

### Bundle optimization and size budget

Continue measuring bundle, map, ASAR, and startup sizes. Consider minification, splitting, or a CI limit only when packaged download size, ASAR size, or measured startup time becomes problematic, or when the renderer bundle grows materially relative to the #43 baseline. Preserve debuggability until a real cost appears.

### Permanent diagnostic access

Keep diagnostics contextual until preview users repeatedly cannot retrieve successful-launch evidence or support work needs a stable “Show Diagnostics” entry point. Add permanent UI only in response to that discoverability problem.

### Retry and runtime recovery

Do not add startup retry, renderer restart, or post-ready hang watchdogs until real transient failures or recoverable renderer hangs are observed. Any future recovery design must coordinate with issue #39 durability and single-instance/deep-link ownership rather than replaying startup phases blindly.
