# Infrequently used agent skills

This directory contains skills intended to be invoked directly when needed.
Unlike skills in `.agents/skills`, they are not contextually available to every
agent thread.

A skill here can be symlinked into `.agents/skills` when it should become
contextually available to every thread.
