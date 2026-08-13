# Claude Code × Claude exercise

Run this exercise through the installed Claude Code CLI, not through T3 Code.

1. Capture `claude --version`, then start a non-interactive Claude Code session
   whose agent reads `npm --silent run markover -- help`.
2. Let that live agent obtain its best observable requesting-thread or session ID from the Claude Code
   runtime. Record `claude-code` as host kind and `claude` as provider. The direct
   host has no separate host-owned thread ID, so omit it.
3. Let the agent run `hostname`, open the maintained exercise source in canonical
   Markover, and return the review ID. Retrieve the raw artifact beneath ignored
   `tmp/review-metadata/`. The source is
   `evals/review-metadata/exercise-source.md`.
4. Record the Claude Code version and any model identifier emitted by the live
   session. Use null plus `not-exposed` for unavailable version fields.
5. Create the capture observation, record sanitized evidence, and verify that the
   reduced output contains no requesting-thread ID, hostname, or local path.

Complete when the recorder accepts the raw artifact and the matrix references the
new sanitized evidence ID.
