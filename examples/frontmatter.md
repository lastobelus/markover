---
# Publishing metadata stays visible in the read-only parent source.
title: Frontmatter review demo
description: >-
  A compact document for reviewing structured YAML metadata alongside
  ordinary Markdown blocks.
authors:
  - name: Ada Lovelace
    role: Editor
  - name: Grace Hopper
    role: Reviewer
tags:
  - markdown
  - agents
publication:
  status: draft
  audience: developers
featured: false
---

# Frontmatter review demo

Select the **YAML Frontmatter** parent to see the complete read-only source,
including its comment and delimiters.

## Structured entries

- Each top-level YAML pair is a child block.
- Multiline lists and mappings stay together as one reviewable block.
- Source-edit proposals remain literal YAML instead of rendered Markdown.

> The original document and checksum remain unchanged while proposed source
> edits travel with the review.

```yaml
example:
  nested: value
```
