# One-shot agent prompts

This directory contains prompts intended to be run directly as one-shot
instructions.

That one-shot lifecycle is the only distinction from `.ai/skills`: a skill can
also be symlinked into `.agents/skills` when it should become contextually
available to every thread.

`decision-gardener.md` is a pinned automation prompt. The trusted gardener
wrapper supplies its immutable Git and ownership input and constrains the
response with `.ai/schemas/decision-gardener-output.schema.json`.
