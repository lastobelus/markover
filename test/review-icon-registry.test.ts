import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerIcon,
  threadHostIcon
} from '../src/review-icon-registry'

test('provider registry normalizes known aliases to bundled icons', () => {
  const codex = providerIcon('Codex')
  const openai = providerIcon('open-ai')
  const claude = providerIcon('claudeAgent')
  assert.ok(codex)
  assert.equal(codex, openai)
  assert.equal(codex.kind, 'vector')
  assert.equal(codex.label, 'Codex')
  assert.ok(claude)
  assert.equal(claude.kind, 'vector')
  assert.equal(claude.label, 'Claude')
  assert.equal(providerIcon('unknown-provider'), null)
})

test('thread-host registry ships the T3 Code favicon without local lookup', () => {
  const t3Code = threadHostIcon('t3-code')
  assert.ok(t3Code)
  assert.equal(t3Code.kind, 'image')
  assert.equal(t3Code.label, 'T3 Code')
  assert.match(t3Code.source, /^data:image\/png;base64,/)
  assert.equal(threadHostIcon('cursor'), null)
})
