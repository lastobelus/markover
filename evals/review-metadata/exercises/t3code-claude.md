# T3 Code × Claude exercise

Run this exercise inside a real Claude-backed T3 Code thread. A direct Claude
Code process does not satisfy this row because it lacks the T3 host boundary.

1. Read `npm --silent run markover -- help` and use its thread metadata guidance.
2. Record the best observable requesting-thread/session ID as `agentThread.id`.
   Record T3 Code as the host kind and Claude as the LLM provider/model family.
   Include a T3 thread ID only when the host exposes a distinct identifier; an
   equal ID remains valid but is unnecessary.
3. Run `hostname`; retain its output only when the command succeeds.
4. Open `evals/review-metadata/exercise-source.md` in canonical Markover,
   retrieve it once, and store the raw JSON beneath `tmp/review-metadata/`.
5. Create the capture observation, record the fixture, and inspect its obvious
   placeholders for the run-specific thread IDs and machine name.

Complete when the recorder accepts the review and the matrix references the new
evidence fixture ID.
