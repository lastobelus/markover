const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  reviewsDirectory,
  serviceDirectory,
  serviceEndpointPath
} = require('../src/service-endpoint')

test('all macOS checkouts share one Markover service endpoint', () => {
  const options = {
    platform: 'darwin',
    homeDirectory: '/Users/reviewer',
    environment: {}
  }
  assert.equal(
    serviceDirectory(options),
    path.join('/Users/reviewer', 'Library', 'Application Support', 'Markover')
  )
  assert.equal(
    serviceEndpointPath(options),
    path.join(
      '/Users/reviewer',
      'Library',
      'Application Support',
      'Markover',
      'service.json'
    )
  )
  assert.equal(
    reviewsDirectory(options),
    path.join(
      '/Users/reviewer',
      'Library',
      'Application Support',
      'Markover',
      'reviews'
    )
  )
})

test('service endpoint has platform-appropriate fallbacks', () => {
  assert.equal(
    serviceEndpointPath({
      platform: 'linux',
      homeDirectory: '/home/reviewer',
      environment: { XDG_CONFIG_HOME: '/config' }
    }),
    path.join('/config', 'Markover', 'service.json')
  )
  assert.equal(
    serviceEndpointPath({
      platform: 'win32',
      homeDirectory: 'C:\\Users\\reviewer',
      environment: { APPDATA: 'C:\\AppData' }
    }),
    path.join('C:\\AppData', 'Markover', 'service.json')
  )
})
