import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVELOPMENT_CONTROL_QUIT,
  DEVELOPMENT_RENDERER_ROOT_ENVIRONMENT,
  DEVELOPMENT_WATCH_ENVIRONMENT,
  developmentRendererRoot,
  isDevelopmentControlQuit
} from '../src/development-control'

test('development watch startup uses one private environment marker', () => {
  assert.equal(DEVELOPMENT_WATCH_ENVIRONMENT, 'MARKOVER_DEVELOPMENT_WATCH')
  assert.equal(
    DEVELOPMENT_RENDERER_ROOT_ENVIRONMENT,
    'MARKOVER_DEVELOPMENT_RENDERER_ROOT'
  )
  assert.equal(
    developmentRendererRoot('/checkouts/markover', 'pr-196'),
    '/checkouts/markover/.markover/generated/pr-196/live-renderer'
  )
  assert.throws(
    () => developmentRendererRoot('/checkouts/markover', '../canonical'),
    /identity is invalid/
  )
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
