import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('private enrichment remains absent from runtime and agent-visible transport', () => {
  for (const relativePath of [
    'src/private-enrichment.ts',
    'src/private-enrichment-store.ts'
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath)
  }

  for (const relativePath of [
    'src/main.ts',
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

  assert.doesNotMatch(
    read('scripts/app-layout.ts'),
    /'private-enrichment'|'private-enrichment-store'/
  )

  for (const relativePath of [
    'src/local-client.ts',
    'src/local-service.ts',
    'src/review-link-copy.ts'
  ]) {
    assert.doesNotMatch(
      read(relativePath),
      /T3ThreadTitle|requestingThreadTitle|t3MetadataDatabasePath/,
      relativePath
    )
  }

  const adapter = read('src/t3-thread-titles.ts')
  assert.match(adapter, /new DatabaseSync\(databasePath, \{[\s\S]*readOnly: true,[\s\S]*timeout: 100/)
  assert.doesNotMatch(adapter, /setInterval|watchFile|createWriteStream/)
})
