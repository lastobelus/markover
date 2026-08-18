# ChatGPT Codex exercise

Run this exercise in a real Codex coding thread inside ChatGPT, rooted at the
checkout being evaluated.

1. Run `eval:metadata:exercise prepare` for `chatgpt-codex`, including the
   observed ChatGPT version. The matrix requires the handoff route. If the
   surface proves `CODEX_THREAD_ID` is nonblank, report that fact without its
   value; the coordinator adds `explicit-runtime` to the matrix before preparing
   that route.
2. Run the returned `captureCommand` exactly as the next agent tool call.
3. Give the private bundle paths to the coordinator; leave tracked evidence and
   `matrix.json` unchanged.

Complete when every exposed route has a private capture bundle and the handoff
route recovers the exact provider session ID.
