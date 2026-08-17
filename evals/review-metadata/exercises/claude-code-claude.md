# Claude Code × Claude exercise

Run this exercise through the installed Claude Code CLI, not through T3 Code.

1. From the checkout being evaluated, run `eval:metadata:exercise prepare` for
   `claude-code-claude`. Add the observed product/model versions when available.
2. Run the returned `captureCommand` exactly as the next agent tool call.
3. Give the private bundle paths to the coordinator; leave tracked evidence and
   `matrix.json` unchanged.

Complete when both routes produce recorder-valid fixture candidates and the
coordinator records them from the private bundles.
