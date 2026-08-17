# Claude Code × Claude exercise

Run this exercise through the installed Claude Code CLI, not through T3 Code.

1. Capture `claude --version`, then start a non-interactive Claude Code session
   whose agent reads `npm --silent run markover -- help`.
2. Run the exercise once with the nonblank `CLAUDE_CODE_SESSION_ID` passed as
   `--thread-id`, and once with that value deliberately withheld and one fresh
   handoff key passed as `--handoff-key`. Record `claude-code` as host kind and
   `claude` as the LLM provider/model family. The direct host has no separate
   host-owned thread ID, so omit it.
3. Let the agent run `hostname`, open the maintained exercise source in canonical
   Markover, and return the review ID. Retrieve the review beneath ignored
   `tmp/review-metadata/`. The source is
   `evals/review-metadata/exercise-source.md`.
4. Record the Claude Code version and any model identifier emitted by the live
   session. Use null plus `not-exposed` for unavailable version fields.
5. Create one capture observation per identity route, record both fixtures, and
   inspect their obvious placeholders for the run-specific thread ID and machine
   name.

Complete when the recorder accepts both reviews and the matrix references one
new evidence fixture ID for each required identity route.
