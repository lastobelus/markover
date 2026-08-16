# Merge and close

Before merging, inspect the addressed issue conversation. Comments added by
other threads are a separate input from Codex pull-request reviews: sort every
adjunct work item, revision request, and finding that bears on this pull
request with the same four verbs, and let any resulting push restart the gates
of stage 3. Merge a stack dependency-first, then re-audit or restack the later
pull requests.

After each verified merge, read Markover's service-free machine-readable help
and follow its `pullRequestStatus` contract for the exact merged pull-request
URL. Run `done` so every matching local review reaches Done; zero matching
reviews is success. Report a lookup or Markover failure without weakening the
verified GitHub merge result.

The merged pull request's work-intent claim completes with the merge, so set
its phase to `completed`. Then refresh the issue conversation for comments
added during the merge before recommending next steps or closing it, and
account for every remaining adjunct item. If work remains, prepare concrete
next steps for the report; the issue's own claim stays as it is. If the issue
is complete, perform the remaining state-only housekeeping, set its claim to
`completed` as well, verify the issue and its trackers reflect completion, and
prepare an archive-ready conclusion.

**Complete when:** the merge is verified, matching Markover reviews are Done,
every completed claim says so, and the issue and its trackers match the real
state.
