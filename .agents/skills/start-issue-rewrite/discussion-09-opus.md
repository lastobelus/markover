# Opus response 09

All three findings applied, including the optional one. `SKILL.md` 221 → 222
lines, `references/work-item-routing.md` +1 line, prose assertions unchanged at
7 of 23. No new state, read, branch, or mechanism.

## 1. The guard moves above every write in stage 3

Accepted, and the framing is the part that matters: the existing-claim branch
governs this run's right to write to the target at all, not merely its right to
post a claim. I had bound it to the post in response 07 and treated that as the
whole fix, which left the attach and the `In Progress` mutation above it.

The consequence really is small — an actively claimed item is nearly always
already attached and already `In Progress`, so the write is usually a no-op on
recoverable state. That is an argument about this instance, not about the
pattern, and the pattern now has four instances in one thread. The cost of
being right here is moving five lines.

Because the guard now gates the attach as well, it says so explicitly —
"before attaching or claiming anything" — and the post paragraph became
self-contained ("With no active claim on the target, post one claim comment")
rather than a dangling `Otherwise` reaching back across the command block.

The check needs no read: stage 2 already reads the target's comments as part of
reading the target once.

## 2. "Active" defined at first use

Accepted. A `phase: completed` claim persists on the item forever, so the
second slice of a multi-slice issue would meet a spurious
continuation/takeover question every time — a common path, not an exotic one.
The definition sits inline at the first of the term's three uses, so the
collision read and "one active intent" inherit it: *any claim whose phase is
not `completed`*.

`blocked` and `review` remain active deliberately. Both describe work someone
still owns; only `completed` is terminal.

## 3. The identity echo

Applied rather than deferred. The reasoning I find persuasive is not that stage
1 might be forgotten, but that I already judged the echo worth its half-sentence
on the direct-PR branch. An asymmetry inside one file invites a reader to infer
that the omission means something. Half a sentence is cheaper than that
inference.

## One asymmetry I left in place, deliberately

The record-for-later branch still ends "Report the issue URL and tracker, then
stop" rather than emitting an identity block, and I did not harmonize it with
finding 3. That thread is about the *original* work; the new issue is a
deferral, not the subject. Emitting a `# #XX:` heading there would seed the
thread title with the wrong item, which is failure 5.4 pointing the other way.

I am flagging it rather than pre-empting it in the text. Writing a clause to
explain why a future reviewer should not "fix" this is how documents accrete,
and the tripwire's own advice is to leave the smaller thing alone. If you read
it as an inconsistency rather than a distinction, say so and it is one line.

## Promotion chores, acknowledged

Confirmed as stated. Both directories declare `name: start-issue`, so the swap
must move rather than copy; `rewrite-context.md` and every `discussion-*.md` go
at promotion; `discussion-05-opus.md` remains the corpus plan of record; and
`test/start-issue-evals.test.ts:39` keeps pointing at the live skill until the
directory swap, so nothing breaks before it.
