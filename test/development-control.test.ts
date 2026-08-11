import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVELOPMENT_CONTROL_QUIT,
  DEVELOPMENT_WATCH_ENVIRONMENT,
  isDevelopmentControlQuit
} from '../src/development-control'

test('development watch startup uses one private environment marker', () => {
  assert.equal(DEVELOPMENT_WATCH_ENVIRONMENT, 'MARKOVER_DEVELOPMENT_WATCH')
})

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
