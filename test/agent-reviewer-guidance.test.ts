import assert from 'node:assert/strict'
import test from 'node:test'

import { FIXED_CONTRACT as AUTHOR_CONTRACT } from '../src/agent-guidance'
import {
  DEFAULT_INTERPRETATION_POLICY,
  FIXED_CONTRACT,
  reviewerGuidance
} from '../src/agent-reviewer-guidance'

test('reviewer guidance is role-specific and complete', () => {
  const guidance = reviewerGuidance()
  assert.equal(guidance.fixedContract, FIXED_CONTRACT)
  assert.equal(guidance.interpretationPolicy, DEFAULT_INTERPRETATION_POLICY)
  assert.notEqual(guidance.fixedContract, AUTHOR_CONTRACT)
  assert.match(guidance.fixedContract, /sole reviewer/)
  assert.match(guidance.fixedContract, /complete markover-review artifact/)
  assert.match(guidance.fixedContract, /review\.agentReviewer\.mode/)
  assert.match(guidance.fixedContract, /Preserve every other field exactly/)
  assert.match(guidance.fixedContract, /Do not add or change attachments/)
})
