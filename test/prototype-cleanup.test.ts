import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '..', '..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('only the addressed managed review lifecycle ships', () => {
  const manifest = JSON.parse(read('package.json')) as {
    scripts?: Record<string, string>
  }
  assert.equal(manifest.scripts?.review, undefined)
  assert.equal(manifest.scripts?.['review:open'], undefined)

  for (const relativePath of [
    'scripts/review.ts',
    'scripts/open-review.ts',
    'src/review-migration.ts'
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false)
  }

  const main = read('src/main.ts')
  const service = read('src/local-service.ts')
  const cli = read('scripts/markover.ts')
  const securityGuide = read('docs/developer/local-service-security.md')
  assert.doesNotMatch(main, /--markover-review|MARKOVER_REVIEW|importLegacyReviews/)
  assert.doesNotMatch(service, /\/reviews\/import|importReviews/)
  assert.doesNotMatch(cli, /\/reviews\/import|\.markover['"], ['"]reviews/)
  assert.doesNotMatch(securityGuide, /open-review/)
  assert.match(securityGuide, /scripts\/markover\.ts/)
  assert.match(securityGuide, /src\/local-service\.ts/)
})

test('manual Markdown opening remains available without a prototype runtime', () => {
  const main = read('src/main.ts')
  const menu = read('src/app-menu.ts')
  const renderer = read('src/renderer.ts')
  assert.match(main, /privilegedIpc\.handle\('document:open', openMarkdown\)/)
  assert.match(menu, /label: 'Open Markdown…'/)
  assert.match(renderer, /openMarkdownDocument[\s\S]*bridge\.openMarkdown\(\)/)
  assert.doesNotMatch(renderer, /finishReview|cancelReview|reviewMode/)
})

test('attachments require a managed review ID', () => {
  const contract = read('src/ipc-contract.ts')
  const renderer = read('src/renderer.ts')
  assert.match(contract, /'attachment:save': \[MarkoverClipboardImage, string\]/)
  assert.match(renderer, /!originReviewId[\s\S]*Attachments are available in managed reviews/)
})
