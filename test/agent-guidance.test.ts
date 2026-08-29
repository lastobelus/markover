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
  assert.match(FIXED_CONTRACT, /substantively addressing discussion and concerns/)
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

test('generic and dedicated agent guidance preserve the same semantics', async () => {
  const [agents, agentGuide, humanGuide, development, babysit, mergeReference, cli] = await Promise.all([
    read('AGENTS.md'),
    read('docs/user/agents/index.html'),
    read('docs/user/guide/index.html'),
    read('docs/developer/development.md'),
    read('.agents/skills/babysit/SKILL.md'),
    read('.agents/skills/babysit/references/merge.md'),
    read('scripts/markover.ts')
  ])

  assert.match(agents, /review\.agentGuidance\.fixedContract/)
  assert.match(agents, /substantively address discussion and concerns/)
  assert.match(agents, /explicitly acknowledge every question/)
  assert.match(agents, /source edits as context-dependent proposals/)
  assert.match(agents, /back-and-forth human QA/)
  assert.match(agents, /keep\s+`npm run dev` running from the owning checkout/)
  assert.match(agents, /after the loop reports `ready`/)
  assert.match(agents, /help payload's `pullRequestStatus`\s+contract/)
  assert.match(
    agents,
    /Before `open`, `get`, `get-for-review`, `revise`, or `done`/
  )
  assert.match(agentGuide, /<code>get-for-review<\/code>/)
  assert.match(agents, /run `revise <reviewId>`/)
  assert.match(agentGuide, /does not classify annotations into rigid types or apply changes itself/)
  assert.match(agentGuide, /substantively address discussion and concerns/)
  assert.match(agentGuide, /Use your judgment to respond to the review and make useful revisions\./)
  assert.match(agentGuide, /Removed X—.*it had no place there/)
  assert.match(agentGuide, /Possible stricter policies/)
  assert.match(agentGuide, /id="revise"/)
  assert.match(agentGuide, /id="done"/)
  assert.match(babysit, /references\/merge\.md/)
  assert.match(babysit, /list_project_actions/)
  assert.match(babysit, /run_project_action_and_resume/)
  assert.match(babysit, /end the turn immediately/)
  assert.match(babysit, /markover-review-head/)
  assert.match(babysit, /markover-review-handled/)
  assert.doesNotMatch(babysit, /While anything is pending,[\s\S]*foreground `sleep 100`/)
  assert.match(mergeReference, /machine-readable\s+help[\s\S]*`pullRequestStatus`/)
  assert.match(mergeReference, /Run `done`/)
  assert.match(cli, /gh pr view <pull-request-url-or-number> --json state,isDraft,url/)
  assert.doesNotMatch(humanGuide, /markover get|markover edit|Default policy|Possible stricter policies/)
  assert.match(development, /Agent-facing instructions must preserve the contract/)
  assert.match(development, /substantive engagement with discussion and concerns/)
  assert.match(development, /npm run dev -- --instance dev/)
  assert.match(development, /existing Electron process/)
  assert.match(development, /size, position, visibility, and focus remain unchanged/)
  assert.match(development, /restart\s+required/)
})
