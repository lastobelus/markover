# ChatGPT Codex exercise

Run this exercise in a real Codex coding thread inside ChatGPT, rooted at this
checkout.

1. Record the exact ChatGPT app version and build, then ask the Codex agent to
   read `npm --silent run markover -- help`.
2. Without printing its value, check only whether `CODEX_THREAD_ID` is nonblank.
   If it is, run an explicit-ID tracer and add `explicit-runtime` to this matrix
   row's required routes. In every case, run a second tracer with that variable
   deliberately withheld and one fresh literal handoff key in the persisted
   prompt before Markover scans.
3. Record `chatgpt` as host kind and `codex` as provider. Omit a host thread ID
   unless the app exposes a distinct host-owned identifier.
4. Let the agent run `hostname`, open
   `evals/review-metadata/exercise-source.md` in canonical Markover, and return
   only the open result. Retrieve each review beneath ignored
   `tmp/review-metadata/`.
5. Create one capture observation per exercised route and inspect the committed
   fixture before referencing it from the matrix. If the forced-key review has
   `agentThread: null`, record the exact app/build and unavailable bounded
   provider store; do not broaden discovery or guess an ID.

Complete when every route ChatGPT exposes is recorded and the required
handoff-key route recovers the exact provider session ID.
