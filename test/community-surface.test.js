const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('yaml')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const form = (relativePath) => parse(read(relativePath))
const field = (document, id) => document.body.find((entry) => entry.id === id)

test('issue forms route bugs and scoped proposals with required context', () => {
  const bug = form('.github/ISSUE_TEMPLATE/bug.yml')
  assert.deepEqual(bug.labels, ['bug'])
  for (const id of [
    'summary',
    'reproduction',
    'expected',
    'actual',
    'version',
    'macos',
    'architecture',
    'launch_method'
  ]) {
    assert.equal(field(bug, id).validations.required, true, `${id} should be required`)
  }
  const bugConfirmations = field(bug, 'confirmations').attributes.options
  assert.equal(bugConfirmations.length, 3)
  assert.equal(bugConfirmations.every((option) => option.required), true)
  assert.match(bugConfirmations[1].label, /private vulnerability reporting/)
  assert.match(bugConfirmations[2].label, /sensitive data/)

  const proposal = form('.github/ISSUE_TEMPLATE/proposal.yml')
  assert.deepEqual(proposal.labels, ['enhancement'])
  for (const id of [
    'discussion',
    'problem',
    'outcome',
    'scope',
    'non_goals',
    'alternatives',
    'validation'
  ]) {
    assert.equal(field(proposal, id).validations.required, true, `${id} should be required`)
  }
})

test('issue chooser disables blank reports and exposes every private or community route', () => {
  const config = form('.github/ISSUE_TEMPLATE/config.yml')
  assert.equal(config.blank_issues_enabled, false)
  const urls = config.contact_links.map((link) => link.url)
  assert.ok(urls.includes('https://github.com/lastobelus/markover/discussions/categories/q-a'))
  assert.ok(urls.includes('https://github.com/lastobelus/markover/discussions/categories/ideas'))
  assert.ok(urls.includes('https://github.com/lastobelus/markover/security/advisories/new'))
  assert.ok(urls.includes(
    'https://github.com/lastobelus/markover/blob/main/CODE_OF_CONDUCT.md#reporting-an-issue'
  ))
})

test('discussion forms match the category slugs and collect useful context', () => {
  const ideas = form('.github/DISCUSSION_TEMPLATE/ideas.yml')
  const questions = form('.github/DISCUSSION_TEMPLATE/q-a.yml')
  assert.equal(field(ideas, 'problem').validations.required, true)
  assert.equal(field(ideas, 'outcome').validations.required, true)
  assert.equal(field(questions, 'question').validations.required, true)
  assert.ok(ideas.body.some((entry) => entry.type !== 'markdown'))
  assert.ok(questions.body.some((entry) => entry.type !== 'markdown'))
})

test('pull request template requests exact validation and omissions', () => {
  const template = read('.github/PULL_REQUEST_TEMPLATE.md')
  assert.match(template, /npm run check/)
  assert.match(template, /npm test/)
  assert.match(template, /manual macOS validation/)
  assert.match(template, /Third-party notices regenerated/)
  assert.match(template, /Not performed/)
})

test('community policies preserve the agreed public boundaries', () => {
  const contributing = read('CONTRIBUTING.md')
  const security = read('SECURITY.md')
  const conduct = read('CODE_OF_CONDUCT.md')
  const readme = read('README.md')

  assert.match(contributing, /Node\.js 22\.13\.0 or newer/)
  assert.match(contributing, /npm run check/)
  assert.match(contributing, /npm test/)
  assert.match(contributing, /context isolation and no Node integration/)
  assert.match(contributing, /exactly one JSON value to stdout/)
  assert.match(contributing, /MIT License/)
  assert.match(contributing, /AI-assistance disclosure is not required/)

  assert.match(security, /Only the latest published release/)
  assert.match(security, /14 calendar days/)
  assert.match(security, /no fixed remediation deadline/i)
  assert.match(security, /GitHub Security Advisory/)
  assert.match(security, /good-faith security research/i)

  assert.match(conduct, /Contributor Covenant 3\.0/)
  assert.match(conduct, /lastobelus@mac\.com/)
  assert.match(conduct, /one maintainer/)
  assert.match(conduct, /CC BY-SA 4\.0/)

  for (const target of [
    './CONTRIBUTING.md',
    './ROADMAP.md',
    './SECURITY.md',
    './CODE_OF_CONDUCT.md'
  ]) assert.ok(readme.includes(target))
})

test('roadmap has the three public phases and live tracking links', () => {
  const roadmap = read('ROADMAP.md')
  const phases = [...roadmap.matchAll(/^## (.+)$/gm)].map((match) => match[1])
  assert.deepEqual(phases, ['Focused preview', 'Broad announcement', 'Later'])
  assert.match(roadmap, /https:\/\/github\.com\/users\/lastobelus\/projects\/3/)
  assert.match(roadmap, /markover\/milestone\/2/)
  assert.match(roadmap, /markover\/milestone\/1/)
  assert.match(roadmap, /untested and\nunsupported/)
  assert.match(roadmap, /funded\nsponsorship or a second maintainer/)
})
