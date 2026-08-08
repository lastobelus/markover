# Markover developer documentation

This directory is for contributors and maintainers. It documents how Markover
is built, tested, packaged, secured, and maintained. The deployed
[user documentation](../user/) is a separate audience root and contains only
the product promises, decisions, actions, and recovery guidance a user needs.

Some facts intentionally appear in both roots. User pages explain consequences
and actions; developer pages record the mechanisms, invariants, evidence, and
maintenance responsibilities that keep those promises true.

## Start here

- [Development setup, checks, packaging, and repository map](./development.md)
- [Local service security and storage mechanics](./local-service-security.md)
- [Release, rollback, and withdrawal runbook](./releasing.md)
- [Architecture and product decisions](../../DECISIONS.md)
- [Roadmap](../../ROADMAP.md)
- [Contributing](../../CONTRIBUTING.md)
- [Security policy](../../SECURITY.md)
- [Repository guidance for agents](../../AGENTS.md)

## User contract

Changes that affect the product promise must also be checked against the
deployed user documentation:

- [Getting started](https://lastobelus.github.io/markover/guide/)
- [Privacy, storage, and recovery](https://lastobelus.github.io/markover/privacy/)
- [Markdown support and preview limitations](https://lastobelus.github.io/markover/limitations/)

Developer documentation may link to those pages, but it must not make users
read implementation detail to understand an ordinary choice, action, risk, or
recovery step. Conversely, user documentation should not be the only record of
a protocol invariant, test boundary, or maintainer procedure.
