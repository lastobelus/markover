import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const manifestPath = path.join(
  root,
  'doc',
  'launch',
  'issue-16',
  'capture-manifest.json'
)

interface CaptureManifest {
  format: string
  fixture: {
    projectRoot: string
    repositories: string[]
  }
  movie: {
    audio: boolean
    maximumSeconds: number
    minimumSeconds: number
  }
  screenshots: Array<{
    consumers: string[]
    filename: string
    state: string
  }>
  staging: {
    appearance: string
    appName: string
    command: string
    palette: string
    registersProtocol: boolean
    stateRoot: string
    usesNetworkContent: boolean
  }
  version: number
  window: {
    densityDpi: number
    logicalHeight: number
    logicalWidth: number
    pixelHeight: number
    pixelWidth: number
    scaleFactor: number
  }
}

function manifest(): CaptureManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CaptureManifest
}

test('public capture contract fixes the isolated Ember Light staging boundary', () => {
  const capture = manifest()
  assert.equal(capture.format, 'markover-public-capture')
  assert.equal(capture.version, 1)
  assert.deepEqual(capture.staging, {
    command: 'npm run capture:stage',
    stateRoot: '/tmp/markover-public-capture',
    appName: 'Markover',
    palette: 'ember',
    appearance: 'light',
    registersProtocol: false,
    usesNetworkContent: false
  })
  assert.equal(capture.fixture.projectRoot.startsWith('/tmp/'), true)
  assert.equal(capture.fixture.repositories.every((repository) => (
    repository.startsWith('https://github.com/markover-demo/')
  )), true)
})

test('public capture contract preserves the four current media states', () => {
  const capture = manifest()
  assert.deepEqual(capture.screenshots.map(({ filename }) => filename), [
    'markover-review-editor@2x.png',
    'markover-annotation-browser@2x.png',
    'markover-source-edit@2x.png',
    'markover-review-context@2x.png'
  ])
  assert.equal(capture.screenshots.every(({ state }) => state.length > 0), true)
  assert.deepEqual(capture.screenshots[0]?.consumers, [
    'README.md',
    'docs/user/index.html'
  ])
})

test('public capture contract retains the Retina still and demo constraints', () => {
  const capture = manifest()
  assert.deepEqual(capture.window, {
    logicalWidth: 1180,
    logicalHeight: 760,
    pixelWidth: 2360,
    pixelHeight: 1520,
    densityDpi: 144,
    scaleFactor: 2
  })
  assert.equal(capture.movie.minimumSeconds, 30)
  assert.equal(capture.movie.maximumSeconds, 60)
  assert.equal(capture.movie.audio, false)
})
