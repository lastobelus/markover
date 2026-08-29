import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CAPTURE_ROOT_MARKER,
  assertSanitizedCaptureState,
  captureLaunchEnvironment,
  captureSource,
  prepareCaptureState
} from '../scripts/capture-media'
import { pngWithDensity, screenshotSpec } from '../scripts/capture-stills'
import {
  addressedDevelopmentBundle
} from '../scripts/development-bundle'
import { parseResolvedInstance } from '../src/instance'
import { discoverReviewProjectContext } from '../src/review-project-context'
import { ReviewStore } from '../src/review-store'
import { SettingsStore } from '../src/settings-store'
import { visitNodes } from '../src/tree'
import { WorkspaceStore } from '../src/workspace-store'

const root = path.resolve(__dirname, '../..')
const manifestPath = path.join(
  root,
  'doc',
  'launch',
  'issue-16',
  'capture-manifest.json'
)
const launchBriefPath = path.join(
  root,
  'doc',
  'launch',
  'issue-16',
  'launch-brief.md'
)
const handoffSummaryPath = path.join(
  root,
  'doc',
  'launch',
  'issue-16',
  'handoff-summary.jq'
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
    scheme: string
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
    scheme: 'markover-capture',
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

test('still capture preserves the exact Pages PNG dimensions and density contract', () => {
  const source = fs.readFileSync(path.join(
    root,
    'docs',
    'user',
    'assets',
    'markover-review-editor@2x.png'
  ))
  const output = pngWithDensity(source)
  assert.deepEqual(screenshotSpec(output), {
    width: 2360,
    height: 1520,
    colorType: 2,
    pixelsPerMetreX: 5669,
    pixelsPerMetreY: 5669,
    unit: 1
  })
})

test('still automation is opt-in, loopback-only, and scoped to the capture app', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'capture-stills.ts'), 'utf8')
  assert.match(source, /prepareCaptureState\(\{ checkout, source \}\)/)
  assert.match(source, /--remote-debugging-address=127\.0\.0\.1/)
  assert.match(source, /markover-internal:\/\/app\/src\/index\.html/)
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8'),
    /remote-debugging/
  )
})

async function captureFixture(t: test.TestContext): Promise<{
  root: string
  prepared: Awaited<ReturnType<typeof prepareCaptureState>>
}> {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'markover-capture-test-'))
  t.after(() => fsp.rm(parent, { recursive: true, force: true }))
  const captureRoot = path.join(parent, 'markover-public-capture-test')
  const prepared = await prepareCaptureState({
    checkout: root,
    generatedAt: new Date('2026-08-29T12:00:00.000Z'),
    root: captureRoot,
    serviceRunning: () => Promise.resolve(false),
    source: { commit: 'a'.repeat(40), dirty: false }
  })
  return { root: captureRoot, prepared }
}

test('capture instance uses production branding with an isolated identity', async (t) => {
  const fixture = await captureFixture(t)
  const instance = fixture.prepared.instance
  assert.deepEqual(parseResolvedInstance(instance), instance)
  assert.deepEqual(instance.identity, { kind: 'capture', key: 'capture' })
  assert.equal(instance.scheme, 'markover-capture')
  assert.equal(instance.stateRoot, fixture.root)
  assert.deepEqual(instance.branding, {
    appName: 'Markover',
    headerBadge: null,
    iconLabel: null,
    iconSvgPath: 'design/brand/markover-app-icon.svg',
    iconPngPath: 'design/brand/markover-app-icon.png',
    iconIcnsPath: 'design/brand/markover-app-icon.icns'
  })
  const address = addressedDevelopmentBundle(instance)
  assert.equal(address.appBundleId, 'com.lastobelus.markover.development.capture')
  assert.equal(address.appName, 'Markover')
  assert.equal(address.scheme, 'markover-capture')
})

test('capture fixture is deterministic, populated, and ready for the four media states', async (t) => {
  const first = await captureFixture(t)
  const store = new ReviewStore(path.join(first.root, 'reviews'))
  const artifacts = (await store.list()).sort((left, right) => (
    left.review.id.localeCompare(right.review.id)
  ))
  assert.deepEqual(artifacts.map(({ review }) => [review.id, review.status]), [
    ['mko_capture01', 'editing'],
    ['mko_capture02', 'pending-agent'],
    ['mko_capture03', 'editing'],
    ['mko_capture04', 'pending-agent'],
    ['mko_capture05', 'editing']
  ])

  const primary = artifacts[0]
  assert.ok(primary)
  assert.equal(
    primary.sourceDocument.content,
    fs.readFileSync(launchBriefPath, 'utf8')
  )
  let annotations = 0
  let sourceEdits = 0
  const attachments: ReviewAttachment[] = []
  visitNodes(primary.root, (node) => {
    if (node.feedback.trim()) annotations += 1
    if (node.sourceEdit) sourceEdits += 1
    attachments.push(...node.attachments || [])
  })
  assert.equal(annotations, 4)
  assert.equal(sourceEdits, 1)
  assert.deepEqual(attachments.map(({ id, label }) => ({ id, label })), [
    { id: 'img-1', label: 'workflow overview' },
    { id: 'img-2', label: 'annotation details' }
  ])
  for (const attachment of attachments) {
    assert.ok(attachment.path?.startsWith(`${first.root}${path.sep}`))
    assert.equal(await fsp.stat(attachment.path as string).then((value) => value.isFile()), true)
  }

  const settings = await new SettingsStore(path.join(first.root, 'settings.json')).read()
  assert.equal(settings.palette, 'ember')
  assert.equal(settings.appearance, 'light')
  assert.equal(settings.discoverAgentThreadFromLocalSessions, false)
  assert.equal(settings.remoteCanonicalGatewayEnabled, false)
  assert.equal(settings.t3MetadataDatabasePath.startsWith(first.root), true)
  const workspace = await new WorkspaceStore(path.join(first.root, 'workspace.json')).load()
  assert.equal(workspace.activeReviewId, 'mko_capture01')
  assert.equal(workspace.navigationMode, 'inbox')
  assert.equal(workspace.rightPaneWidth, 390)
  assert.equal(Object.keys(workspace.reviews).length, 5)

  const contexts = await Promise.all(artifacts.map((artifact) => (
    discoverReviewProjectContext(artifact)
  )))
  assert.deepEqual(contexts.map((context) => ({
    evidence: context.projectEvidence,
    name: context.project?.name,
    source: context.sourceState
  })), [
    { evidence: 'verified', name: 'atlas-studio', source: 'unchanged' },
    { evidence: 'verified', name: 'atlas-studio', source: 'unchanged' },
    { evidence: 'verified', name: 'field-research', source: 'unchanged' },
    { evidence: 'verified', name: 'field-research', source: 'unchanged' },
    { evidence: 'verified', name: 'review-protocol', source: 'unchanged' }
  ])

  const serialized = artifacts.map((artifact) => JSON.stringify(artifact)).join('\n')
  assert.doesNotMatch(serialized, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(serialized, /lastobelus|t3code-[a-f0-9]+/i)

  const semanticSnapshot = JSON.stringify({
    artifacts,
    settings,
    workspace,
    receipt: first.prepared.receipt
  })
  await prepareCaptureState({
    checkout: root,
    generatedAt: new Date('2026-08-29T12:00:00.000Z'),
    root: first.root,
    serviceRunning: () => Promise.resolve(false),
    source: { commit: 'a'.repeat(40), dirty: false }
  })
  const resetStore = new ReviewStore(path.join(first.root, 'reviews'))
  const resetArtifacts = (await resetStore.list()).sort((left, right) => (
    left.review.id.localeCompare(right.review.id)
  ))
  const resetSettings = await new SettingsStore(path.join(first.root, 'settings.json')).read()
  const resetWorkspace = await new WorkspaceStore(path.join(first.root, 'workspace.json')).load()
  const resetReceipt: unknown = JSON.parse(await fsp.readFile(
    path.join(first.root, 'session.json'),
    'utf8'
  ))
  assert.equal(JSON.stringify({
    artifacts: resetArtifacts,
    settings: resetSettings,
    workspace: resetWorkspace,
    receipt: resetReceipt
  }), semanticSnapshot)
})

test('capture reset requires its exact marker and a stopped service', async (t) => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'markover-capture-reset-'))
  t.after(() => fsp.rm(parent, { recursive: true, force: true }))
  const captureRoot = path.join(parent, 'markover-public-capture-test')
  await fsp.mkdir(captureRoot)
  await fsp.writeFile(path.join(captureRoot, 'keep.txt'), 'not owned\n', 'utf8')
  await assert.rejects(prepareCaptureState({
    checkout: root,
    root: captureRoot,
    serviceRunning: () => Promise.resolve(false),
    source: { commit: 'b'.repeat(40), dirty: false }
  }), /unrecognized capture root/)
  assert.equal(fs.existsSync(path.join(captureRoot, 'keep.txt')), true)

  await fsp.rm(captureRoot, { recursive: true })
  const first = await prepareCaptureState({
    checkout: root,
    root: captureRoot,
    serviceRunning: () => Promise.resolve(false),
    source: { commit: 'b'.repeat(40), dirty: false }
  })
  assert.equal(fs.existsSync(path.join(captureRoot, CAPTURE_ROOT_MARKER)), true)
  await assert.rejects(prepareCaptureState({
    checkout: root,
    root: captureRoot,
    serviceRunning: () => Promise.resolve(true),
    source: { commit: 'b'.repeat(40), dirty: false }
  }), /capture instance is running/)
  assert.equal(first.receipt.commit, 'b'.repeat(40))
})

test('capture launch strips private session identity and suppresses protocol registration', async (t) => {
  const fixture = await captureFixture(t)
  const environment = captureLaunchEnvironment(fixture.prepared.instance, {
    CLAUDE_CODE_SESSION_ID: 'private-claude',
    CODEX_THREAD_ID: 'private-codex',
    ELECTRON_RUN_AS_NODE: '1',
    KEEP_ME: 'safe'
  })
  assert.equal(environment.CLAUDE_CODE_SESSION_ID, undefined)
  assert.equal(environment.CODEX_THREAD_ID, undefined)
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(environment.KEEP_ME, 'safe')
  assert.equal(environment.MARKOVER_SUPPRESS_PROTOCOL_REGISTRATION, '1')
  assert.match(environment.MARKOVER_RESOLVED_INSTANCE || '', /"kind":"capture"/)
})

test('capture source rejects dirty Git state', async (t) => {
  const repository = await fsp.mkdtemp(path.join(os.tmpdir(), 'markover-capture-git-'))
  t.after(() => fsp.rm(repository, { recursive: true, force: true }))
  execFileSync('git', ['init', '--quiet'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Capture Test'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'capture@example.invalid'], { cwd: repository })
  await fsp.writeFile(path.join(repository, 'tracked.txt'), 'clean\n', 'utf8')
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '--quiet', '-m', 'Fixture'], { cwd: repository })
  assert.equal(captureSource(repository).dirty, false)
  await fsp.writeFile(path.join(repository, 'untracked.txt'), 'dirty\n', 'utf8')
  assert.throws(() => captureSource(repository), /clean Git worktree/)
})

test('capture sanitization rejects an injected private value', async (t) => {
  const fixture = await captureFixture(t)
  const injected = path.join(fixture.root, 'injected.json')
  await fsp.writeFile(injected, JSON.stringify({ secret: 'private-thread-value' }), 'utf8')
  await assert.rejects(
    assertSanitizedCaptureState(fixture.root, ['private-thread-value']),
    /Private capture value found/
  )
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

test('demo handoff projection keeps only publishable review fields', () => {
  const filter = fs.readFileSync(handoffSummaryPath, 'utf8')
  assert.match(filter, /review: \{ status: \.review\.status \}/)
  assert.match(filter, /attachments: \[/)
  assert.match(filter, /\.attachments\[\] \| \{ id, label \}/)
  assert.match(filter, /sourceEdit/)
  assert.doesNotMatch(filter, /agentThread|authorization|machine|path|pullRequest/)
})
