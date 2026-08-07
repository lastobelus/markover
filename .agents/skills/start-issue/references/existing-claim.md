# Existing work-intent claim

Create no new claim while the target already has a trusted marked comment.
Apply the deterministic winner rule in stage 3 of `SKILL.md`, show the canonical
intent to the user, and ask whether this run is a continuation or handoff.

Reuse the comment only when its `thread` equals this run's owner token and the
user approves the continuation. For an approved handoff or a legacy null token,
preserve the intent data. Demote the old marker only after its owner acknowledges
relinquishment or the user explicitly confirms that run has stopped, then create
a new marked claim with this run's token in stage 3.

Keep a separate concurrent effort paused until the user chooses a distinct
issue or pull request. V1 represents one active intent per item.
