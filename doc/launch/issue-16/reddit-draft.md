# r/codex focused-preview draft

## Title

I built a little Electron app for reviewing agent-written Markdown block by block

## Body

I kept running into the same problem when an agent produced a long plan or
specification: chat made it hard to keep each note attached to the exact
paragraph, list item, or code block it referred to.

Screenshots made that worse. I wanted to paste several visual references, give
them useful labels, and cite them from a question. I also wanted to propose an
exact edit beside ordinary feedback without losing the original document. When
I came back later, I wanted every note to retain its source context.

I made Markover for that workflow. An agent opens a Markdown file, then stops
while you review it as a document tree. You can add Markdown feedback and
labeled screenshots to individual blocks, or edit a source block to create a
proposal shown as a word-level diff. When you say “Check Markover” in the agent
thread, the agent retrieves one structured handoff containing the original
source, annotations, attachments, proposals, and review context.

The short demo shows that complete loop: **[DEMO_URL]**

Markover is a free, MIT-licensed early preview for macOS. It requires no
account, and review data stays on your Mac. The generic workflow works with
agents that have macOS shell access; the focused preview is verified with Codex
and T3 Code.

The preview currently requires Node.js 22.13.0 or newer. The app is ad-hoc
signed rather than Developer ID signed or notarized, so macOS may ask you to
confirm opening it. The README has the exact command pinned to **[PREVIEW_TAG]**
and explains the full handoff lifecycle:

**https://github.com/lastobelus/markover**

The product page and guide are here:

**https://lastobelus.github.io/markover/**

If this matches your workflow, try it on one real Markdown document and tell me
the first step that is confusing or broken. A reply here is fine for a quick
note. For a reproducible failure, the repository has a structured bug form that
captures the Mac and launch details needed to investigate it.

## Posting checklist

- Replace `[DEMO_URL]` and `[PREVIEW_TAG]` with verified final values.
- Recheck r/codex project-promotion rules on posting day.
- Upload the MP4 natively and select the canonical demo poster if Reddit allows
  a custom thumbnail.
- Do not post until issue 16 has final-state evidence and issue 17 authorizes the
  announcement window.
