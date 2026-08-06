import assert from 'node:assert/strict'
import test from 'node:test'

const {
  DEFAULT_INTERPRETATION_POLICY,
  FIXED_CONTRACT,
  FIXED_CONTRACT_STATEMENTS,
  guidance
} = require('../src/agent-guidance') as MarkoverAgentGuidanceApi

test('central guidance distinguishes mixed feedback without prescribing workflow', () => {
  assert.match(FIXED_CONTRACT, /may mix revision requests, questions, discussion, and context/)
  assert.match(FIXED_CONTRACT, /explicitly acknowledge every question/)
  assert.match(FIXED_CONTRACT, /source edits as proposals/)
  assert.match(DEFAULT_INTERPRETATION_POLICY, /Use your judgment/)
  assert.match(DEFAULT_INTERPRETATION_POLICY, /Ask for clarification when needed/)
  assert.equal(FIXED_CONTRACT_STATEMENTS.length, 4)
  assert.equal(FIXED_CONTRACT_STATEMENTS.join(' '), FIXED_CONTRACT)
  assert.equal(Object.isFrozen(FIXED_CONTRACT_STATEMENTS), true)
})

test('guidance combines the fixed contract with a replaceable policy', () => {
  assert.deepEqual(guidance('Follow a strict review checklist.'), {
    fixedContract: FIXED_CONTRACT,
    interpretationPolicy: 'Follow a strict review checklist.'
  })
  assert.equal(
    guidance(undefined).interpretationPolicy,
    DEFAULT_INTERPRETATION_POLICY
  )
})
