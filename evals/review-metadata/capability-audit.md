# Installed metadata capability audit

Recorded 2026-08-17 on the machine used for the #171 implementation. Session
identifiers are intentionally recorded only as present or absent.

| Surface | Installed build | Runtime identity evidence | Checkpoint consequence |
| --- | --- | --- | --- |
| T3 Code Nightly with Codex | T3 Code `0.0.34-nightly.20260817.1113`; Codex CLI `0.147.0` | The active T3/Codex agent process exposes a nonblank `CODEX_THREAD_ID`. | Guidance may name that one variable; checkpoint 5 must exercise both the explicit and forced-key routes. |
| T3 Code Alpha | T3 Code `0.0.28` | Installed, but not the active host for this audit. | Do not infer an environment contract from installation alone. |
| T3 Code with Claude | Prior live conformance evidence records a provider session ID from the agent runtime; T3's installed Claude adapter uses `CLAUDE_CODE_SESSION_ID`. | The exact variable is proven for this host/provider integration without recording its value. | Guidance may name that one variable; checkpoint 5 must exercise both routes in a live Claude-backed T3 thread. |
| Claude Code CLI | `2.1.234` | Installed; direct-session exposure is not established by this Codex-hosted process. | Checkpoint 5 must launch the CLI exercise and record whether `CLAUDE_CODE_SESSION_ID` is nonblank there. |
| Claude desktop | Claude.app `1.30096.5` | Installed; invocation and environment exposure are not yet established. | The Focused-preview gate stays open until checkpoint 5 proves an invocation-capable exact-ID or exact-key route, or records the external dependency. |
| ChatGPT with Codex | ChatGPT `26.810.52044` (build `6662`); bundle ID `com.openai.codex` | Installed as `/Applications/ChatGPT.app`; runtime exposure is not yet established. [Official OpenAI documentation](https://developers.openai.com/) confirms that ChatGPT and Codex now share one app. | Checkpoint 5 must exercise the installed ChatGPT Codex surface and record its exact-ID or exact-key capability; do not look for a legacy `Codex.app` bundle. |

The audit used product version commands, application bundle metadata, and
presence-only environment checks. It does not infer desktop capability from a
CLI installation, copy literal thread IDs, or treat a missing variable in one
host process as evidence about a different product surface.
