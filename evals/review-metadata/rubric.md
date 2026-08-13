# Review metadata conformance rubric

Evaluate the retrieved `markover-review` v1 artifact. A run passes
only when every check below passes. A structural failure is evidence against the
current guidance or implementation; it is not permission to relax the portable
contract.

## Automatic checks

- `portableV1Valid` — the shared v1 decoder accepts the complete artifact.
- `supportedCombination` — `threadHost.kind` and `threadHost.provider` exactly
  match the selected matrix entry.
- `requiredFieldsObserved` — a non-null snapshot has an observed requesting-thread
  `agentThread.id`, host kind, and LLM provider/model family.
- `threadHostIdAccepted` — an included host-owned `threadId` may be distinct or
  equal. Distinct-or-omitted remains the preferred guidance, but equality is valid.
- `machineAttempted` — the exercise records a real `hostname` attempt and keeps
  the value only when observed.
- `nullFallbackTruthful` — `agentThread: null` is accepted only for a matrix row
  that permits unavailable identity and records the provider ID as unavailable.
- `guessedValuesAbsent` — every retained identity value has an observed discovery
  source; unavailable values are omitted.

## Human attestation

The exercising agent or maintainer confirms that each discovery source describes
what the live environment actually exposed. This attestation is narrow: it does
not rescue a failed automatic check or assert that an unavailable field exists.

## Defect routing

If truthful live output conflicts with the published v1 contract, open or link a
contract defect descended from issue #99. Guidance drift is fixed in guidance;
schema defects are fixed through the versioned compatibility rules rather than by
weakening this rubric.
