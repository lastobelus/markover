I interpreted “Retries: 5” as a proposal contingent on whether five attempts could overload the upstream service. Since that risk isn’t resolved by the review, I left `document.md` at `Retries: 3`.

The question is acknowledged: five retries may increase upstream load, so raising the limit should depend on the service’s retry/backoff tolerance.