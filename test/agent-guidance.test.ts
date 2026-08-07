import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const {
  DEFAULT_INTERPRETATION_POLICY,
  FIXED_CONTRACT,
  FIXED_CONTRACT_STATEMENTS,
  guidance
} = require('../src/agent-guidance') as MarkoverAgentGuidanceApi

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): Promise<string> =>
  fs.readFile(path.join(root, relativePath), 'utf8')

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

test('generic agent and public guidance preserve the same semantics', async () => {
  const [agents, readme, guide, development] = await Promise.all([
    read('AGENTS.md'),
    read('README.md'),
    read('docs/user/guide/index.html'),
    read('docs/developer/development.md')
  ])

  assert.match(agents, /review\.agentGuidance\.fixedContract/)
  assert.match(agents, /explicitly acknowledge every question/)
  assert.match(agents, /source edits as context-dependent proposals/)
  assert.match(readme, /does not classify annotations\s+or apply changes itself/)
  assert.match(guide, /Use your judgment to respond to the review and make useful revisions\./)
  assert.match(guide, /Removed X—.*it had no place there/)
  assert.match(guide, /Optional stricter policies/)
  assert.match(development, /Agent-facing instructions must preserve the contract/)
})
