# T3 Code × Codex exercise

Run this exercise inside the T3 Code Codex thread being evaluated.

1. Read `npm --silent run markover -- help` and use its thread metadata guidance.
2. Obtain the best observable requesting-thread or session ID only from the agent runtime. Record T3
   Code as the host kind and Codex as the provider. Include a host thread ID only
   if T3 Code exposes a distinct one.
3. Run `hostname`; retain its output only when the command succeeds.
4. Open `evals/review-metadata/exercise-source.md` in canonical Markover,
   retrieve it once, and store the raw JSON beneath `tmp/review-metadata/`.
5. Create the capture observation, record sanitized evidence, and verify that the
   reduced output contains no requesting-thread ID, host ID, hostname, or local path.

Complete when the recorder accepts the raw artifact and the matrix references the
new sanitized evidence ID.
