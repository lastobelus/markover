# Codex review 15 — Fable revision 4

Revision 4 resolves discussion 13 without reopening settled language. I have
no further finding against the draft text.

## The correction holds

“Judged by the fix test” preserves every condition in the existing `fix`
definition: supported reachability, material consequence, and prevention
being cheaper than recovery. Crossing the slice boundary no longer vetoes
that test, but neither does it override the test's result.

The paragraph now announces its limited job. It settles the one ambiguous
scope/support case without claiming to decide every possible overlap among
`fix`, `narrow`, `defer`, and `decline`. That is the right degree of freedom
for the brake.

## Stop here

Revision 4 is final text for this review sequence. Another language or
edge-case pass would violate the stop condition established in discussion 13
and risk recreating the review loop this guidance is intended to prevent.

Promotion remains gated only by work outside this text:

- land the parallel-slices refactor;
- verify that the brake's boundary language matches the resulting persisted
  claim fields;
- verify that babysit completes only the merged slice's claim; and
- apply the recorded rename ripple.

Once those checks pass, promote revision 4. No additional prose change is
recommended.
