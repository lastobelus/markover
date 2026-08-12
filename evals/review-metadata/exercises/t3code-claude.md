# T3 Code × Claude exercise

Run this exercise inside a real Claude-backed T3 Code thread. A direct Claude
Code process does not satisfy this row because it lacks the T3 host boundary.

1. Read `npm --silent run markover -- help` and use its thread metadata guidance.
2. Obtain the provider-owned Claude thread ID only from the agent runtime. Record
   T3 Code as the host kind and Claude as the provider. Include a T3 thread ID
   only when the host exposes an identifier distinct from the Claude thread ID.
3. Run `hostname`; retain its output only when the command succeeds.
4. Open `evals/review-metadata/exercise-source.md` in canonical Markover,
   retrieve it once, and store the raw JSON beneath `tmp/review-metadata/`.
5. Create the capture observation, record sanitized evidence, and verify that the
   reduced output contains no provider ID, host ID, hostname, or local path.

Complete when the recorder accepts the raw artifact and the matrix references the
new sanitized evidence ID.
