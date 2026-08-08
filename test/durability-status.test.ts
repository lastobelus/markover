import assert from 'node:assert/strict'
import test from 'node:test'

import { autosaveFailureMessage } from '../src/durability-status'

test('autosave durability warnings cover slow writes and failures, then disappear', () => {
  assert.equal(autosaveFailureMessage([]), null)
  assert.equal(
    autosaveFailureMessage(['mko_aaa11111']),
    'Autosave is delayed or retrying. Your latest review changes may not be saved yet.'
  )
  assert.equal(
    autosaveFailureMessage(['mko_aaa11111', 'mko_bbb22222']),
    'Autosave is delayed or retrying for 2 reviews. Their latest changes may not be saved yet.'
  )
})
