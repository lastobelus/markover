const test = require('node:test')
const assert = require('node:assert/strict')

test('reports proposal line additions and deletions with Pierre Diffs', async () => {
  const { stats } = await import('../src/pierre-diffs-entry.mjs')

  assert.deepEqual(
    stats('one\ntwo\n', 'one\nthree\nfour\n'),
    { additions: 2, deletions: 1 }
  )
  assert.deepEqual(stats('unchanged', 'unchanged'), {
    additions: 0,
    deletions: 0
  })
})
