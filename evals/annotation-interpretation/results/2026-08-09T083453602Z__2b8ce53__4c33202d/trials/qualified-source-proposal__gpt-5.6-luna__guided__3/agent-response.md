Updated `document.md` to:

```text
Retries: 5
```

Regarding the question: five retries could overload the upstream service, depending on traffic and backoff behavior. The document does not provide enough context to determine that risk, so the change should be validated against upstream capacity before rollout.