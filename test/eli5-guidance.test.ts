import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): Promise<string> =>
  fs.readFile(path.join(root, relativePath), 'utf8')

test('ELI5 diagrams use the repository-owned Markover profile without an onboarding wizard', async () => {
  const [agents, skill, optionalSurfaces, experimentHistory, designBrief] =
    await Promise.all([
      read('AGENTS.md'),
      read('.agents/skills/eli5-html-doc/SKILL.md'),
      read('.agents/skills/eli5-html-doc/references/optional-surfaces.md'),
      read('.agents/skills/eli5-html-doc/references/experiment-history.md'),
      read('doc/design/markover-design-brief.md')
    ])

  assert.match(agents, /visual design[\s\S]*doc\/design\/markover-design-brief\.md/)
  assert.match(skill, /follow\s+`doc\/design\/markover-design-brief\.md`/)
  assert.match(optionalSurfaces, /repository-owned Diagram Design profile/)
  assert.match(optionalSurfaces, /Treat that profile as\s+completed onboarding/)
  assert.match(optionalSurfaces, /proceed directly\s+to type selection/)
  assert.match(optionalSurfaces, /Then check for the optional shared diagram-design skill/)
  assert.match(optionalSurfaces, /without inspecting or changing a home-directory profile/)
  assert.match(experimentHistory, /already-onboarded\s+Diagram Design profile/)

  for (const role of [
    'paper',
    'paper-2',
    'ink',
    'muted',
    'soft',
    'rule',
    'rule-solid',
    'accent',
    'accent-tint',
    'link'
  ]) {
    assert.match(designBrief, new RegExp('^\\| `' + role + '` \\|', 'm'))
  }

  for (const role of [
    'title',
    'node-name',
    'sublabel',
    'eyebrow',
    'arrow-label',
    'callout'
  ]) {
    assert.match(designBrief, new RegExp('^\\| `' + role + '` \\|', 'm'))
  }

  assert.match(designBrief, /`paper`[^\n]+`#f7f4ee`[^\n]+`#1d1816`/)
  assert.match(designBrief, /`accent`[^\n]+`#c94e1f`[^\n]+`#e5b8a8`/)
  assert.match(designBrief, /require no remote font/)
})
