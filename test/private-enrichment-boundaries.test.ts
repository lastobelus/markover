import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('private enrichment has no agent-visible or renderer transport', () => {
  for (const relativePath of [
    'src/local-client.ts',
    'src/local-service.ts',
    'src/preload.ts',
    'src/renderer.ts',
    'src/review-link-copy.ts'
  ]) {
    assert.doesNotMatch(
      read(relativePath),
      /private-enrichment|PrivateEnrichment|enrichment\.json/,
      relativePath
    )
  }

  const main = read('src/main.ts')
  const managedDocument = main.slice(
    main.indexOf('function managedDocument('),
    main.indexOf('function projectRootForReview(')
  )
  assert.doesNotMatch(managedDocument, /privateEnrichment|enrichment/)
  assert.match(main, /privateEnrichmentStore\.cleanupThreadAfterTrash/)
  assert.match(main, /privateEnrichmentStore\.pauseAndDrain/)
  assert.match(main, /privateEnrichmentStore\.flush/)
})
