# Launch readiness brief

Ship the review pilot to everyone as soon as the first workflow is complete.

## Success criteria

- Every handoff names an owner and next action.
- Review feedback stays attached to the relevant Markdown block.
- Source proposals remain explicit and reversible.
- Attachments use clear labels.
- The pilot expands only after the loop is reliable.

## Rollout plan

Start with the design-partner group, observe three complete review loops, and
record blocked or deferred work before expanding.

| Signal | Ready when |
| --- | --- |
| Ownership | Every note has a named owner |
| Reliability | Three handoffs complete without recovery |

```ts
await openReview({ retry: true })
```
