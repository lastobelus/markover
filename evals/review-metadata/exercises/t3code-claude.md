# T3 Code × Claude exercise

Run this exercise inside a real Claude-backed T3 Code thread. A direct Claude
Code process does not satisfy the T3 host boundary.

1. From the checkout being evaluated, run `eval:metadata:exercise prepare` for
   `t3code-claude`. Pass `--thread-host-thread-id` only when T3 exposes the exact
   distinct host-owned ID.
2. Run the returned `captureCommand` exactly as the next agent tool call.
3. Give the private bundle paths to the coordinator; leave tracked evidence and
   `matrix.json` unchanged.

Complete when both routes produce recorder-valid fixture candidates and the
coordinator records them from the private bundles.
