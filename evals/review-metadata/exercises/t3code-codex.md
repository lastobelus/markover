# T3 Code × Codex exercise

Run this exercise inside the T3 Code Codex thread being evaluated.

1. Read `npm --silent run markover -- help` and use its thread metadata guidance.
2. Run the exercise once with the nonblank `CODEX_THREAD_ID` passed as
   `--thread-id`, and once with that value deliberately withheld and one fresh
   handoff key passed as `--handoff-key`.
3. In each result, record the requesting-session ID as `agentThread.id`.
   Record T3 Code as the host kind and Codex as the LLM provider/model family.
   Include a host thread ID only if T3 Code exposes a distinct one; an equal ID
   remains valid but is unnecessary.
4. Run `hostname`; retain its output only when the command succeeds.
5. Open `evals/review-metadata/exercise-source.md` in canonical Markover,
   retrieve it once, and store the raw JSON beneath `tmp/review-metadata/`.
6. Create one capture observation per identity route, record both fixtures, and
   inspect their obvious placeholders for the run-specific thread IDs and machine
   name.

Complete when the recorder accepts both reviews and the matrix references one
new evidence fixture ID for each required identity route.
