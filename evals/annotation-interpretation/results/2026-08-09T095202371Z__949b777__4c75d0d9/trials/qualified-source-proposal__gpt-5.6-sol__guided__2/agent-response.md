Updated the setting to `Retries: 5`.

Five retries could increase upstream load, especially without exponential backoff, jitter, or retry limits. The document doesn’t provide enough operational detail to determine whether it would overload the service, so this should be validated against expected traffic and retry behavior.