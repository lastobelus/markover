Updated the document to `Retries: 5`.

Five retries will increase failure-path traffic, but the available information doesn’t establish whether that would overload the upstream service. That should be validated against its capacity and retry backoff behavior.