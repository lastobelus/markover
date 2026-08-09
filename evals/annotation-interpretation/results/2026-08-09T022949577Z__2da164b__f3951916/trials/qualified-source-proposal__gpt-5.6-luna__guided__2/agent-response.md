I kept the retry count at 3 and added a condition that increasing it to 5 should require validating the added upstream load.

Regarding your question: yes, five retries could overload the upstream service, so that change should wait for capacity validation.