import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVELOPMENT_CONTROL_QUIT,
  isDevelopmentControlQuit
} from '../src/development-control'

test('development quit control accepts only the exact private message', () => {
  assert.equal(isDevelopmentControlQuit(DEVELOPMENT_CONTROL_QUIT), true)
  assert.equal(isDevelopmentControlQuit({
    ...DEVELOPMENT_CONTROL_QUIT,
    extra: true
  }), false)
  assert.equal(isDevelopmentControlQuit({
    ...DEVELOPMENT_CONTROL_QUIT,
    action: 'restart'
  }), false)
})
