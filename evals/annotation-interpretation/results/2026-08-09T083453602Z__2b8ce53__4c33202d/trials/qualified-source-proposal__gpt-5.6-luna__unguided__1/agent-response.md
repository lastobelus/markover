Updated `document.md` to:

> Retries: 5

Five retries could increase upstream load, so the concern is valid. We should confirm the service can tolerate the added attempts before rollout.