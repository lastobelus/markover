# Codex CLI × Codex exercise

Run this exercise through the installed Codex CLI, not through T3 Code or the
ChatGPT desktop app.

1. Capture `codex --version`, then start a persisted non-interactive Codex CLI
   session rooted at this checkout whose agent reads
   `npm --silent run markover -- help`.
2. Run the exercise once with the nonblank `CODEX_THREAD_ID` passed as
   `--thread-id`, and once with that value deliberately withheld and one fresh
   handoff key passed as `--handoff-key`. Put the fallback key literally in the
   persisted initial prompt before Markover scans; do not use an ephemeral
   session.
3. Record `codex-cli` as host kind and `codex` as provider. Omit a host thread
   ID unless the CLI exposes a distinct host-owned identifier.
4. Let the agent run `hostname`, open
   `evals/review-metadata/exercise-source.md` in canonical Markover, and return
   only the open result. Retrieve each review beneath ignored
   `tmp/review-metadata/`.
5. Create one capture observation per identity route, record both fixtures, and
   inspect their placeholders for the run-specific provider ID and machine.

Complete when the recorder accepts both reviews and the matrix references one
new evidence fixture for each required identity route.
