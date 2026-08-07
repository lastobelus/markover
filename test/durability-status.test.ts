import assert from 'node:assert/strict'
import test from 'node:test'

import { autosaveFailureMessage } from '../src/durability-status'

test('autosave storage warnings remain specific and disappear on recovery', () => {
  assert.equal(autosaveFailureMessage([]), null)
  assert.match(
    autosaveFailureMessage(['mko_aaa11111']) || '',
    /latest review changes may not be saved yet/
  )
  assert.match(
    autosaveFailureMessage(['mko_aaa11111', 'mko_bbb22222']) || '',
    /2 reviews/
  )
})
