import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  addressedDevelopmentExecutable,
  buildAddressedDevelopmentBundle
} from './development-bundle'
import {
  captureResolvedInstance,
  developmentStateRoot,
  parseResolvedInstance,
  RESOLVED_INSTANCE_ENVIRONMENT,
  resolvedInstanceEnvironment,
  type ResolvedInstance
} from '../src/instance'
import { probeService } from '../src/local-client'
import { SUPPRESS_PROTOCOL_REGISTRATION_ENVIRONMENT } from '../src/protocol-registration'
import { reviewChecksum } from '../src/review-format'
import { ReviewStore, type ReviewArtifact } from '../src/review-store'
import { serviceDirectory } from '../src/service-endpoint'
import { SettingsStore } from '../src/settings-store'
import { findNode, parseMarkdown, visitNodes } from '../src/tree'
import { WorkspaceStore } from '../src/workspace-store'

export const CAPTURE_FIXTURE_REVISION = 1
export const CAPTURE_ROOT = '/tmp/markover-public-capture'
export const CAPTURE_ROOT_MARKER = '.markover-public-capture-root.json'
export const CAPTURE_SESSION_RECEIPT = 'session.json'

const fixtureFormat = 'markover-public-capture-root'
const sessionFormat = 'markover-public-capture-session'
const fixtureTimestamp = '2026-08-29T12:00:00.000Z'
const captureReviewIds = [
  'mko_capture01',
  'mko_capture02',
  'mko_capture03',
  'mko_capture04',
  'mko_capture05'
] as const
const sessionEnvironmentKeys = [
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_SESSION_ID',
  'CODEX_THREAD_ID',
  'T3CODE_THREAD_ID',
  'T3_THREAD_ID'
] as const

interface CaptureSource {
  commit: string
  dirty: false
}

export interface CaptureSessionReceipt {
  appearance: 'light'
  commit: string
  dirty: false
  fixtureRevision: number
  format: typeof sessionFormat
  generatedAt: string
  palette: 'ember'
  reviewIds: string[]
  stateRoot: string
  version: 1
  window: {
    height: 760
    width: 1180
  }
}

interface CaptureRepository {
  branch: string
  commit: string
  logicalRoot: string
  name: string
  remote: string
  sources: Record<string, string>
}

interface CaptureReviewDefinition {
  branch: string
  contextSummary: string
  document: string
  id: string
  project: CaptureRepository
  pullRequestNumber: number
  status: 'editing' | 'pending-agent'
  threadId: string
  threadTitle: string
}

export interface PrepareCaptureOptions {
  checkout: string
  generatedAt?: Date
  root?: string
  serviceRunning?: (endpointPath: string) => Promise<boolean>
  source: CaptureSource
}

export interface PreparedCapture {
  instance: ResolvedInstance
  receipt: CaptureSessionReceipt
}

function command(
  workingDirectory: string,
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env
): string {
  return execFileSync(executable, args, {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

export function captureSource(checkout: string): CaptureSource {
  const commit = command(checkout, 'git', ['rev-parse', 'HEAD'])
  const status = command(checkout, 'git', [
    'status',
    '--porcelain',
    '--untracked-files=all'
  ])
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Capture requires an exact Git commit.')
  }
  if (status) {
    throw new Error('Capture requires a clean Git worktree; commit or remove every change first.')
  }
  return { commit, dirty: false }
}

function captureMarker(): string {
  return `${JSON.stringify({
    format: fixtureFormat,
    version: 1,
    fixtureRevision: CAPTURE_FIXTURE_REVISION
  }, null, 2)}\n`
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      Reflect.get(error, 'code') === 'ENOENT'
    ) return false
    throw error
  }
}

async function defaultServiceRunning(endpointPath: string): Promise<boolean> {
  try {
    await probeService(endpointPath)
    return true
  } catch {
    return false
  }
}

async function assertResettableCaptureRoot(
  root: string,
  serviceRunning: (endpointPath: string) => Promise<boolean>
): Promise<void> {
  let stats
  try {
    stats = await fs.lstat(root)
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      Reflect.get(error, 'code') === 'ENOENT'
    ) return
    throw error
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Capture root is not an owned directory: ${root}`)
  }
  const markerPath = path.join(root, CAPTURE_ROOT_MARKER)
  const marker = await fs.readFile(markerPath, 'utf8').catch(() => '')
  if (marker !== captureMarker()) {
    throw new Error(`Refusing to replace an unrecognized capture root: ${root}`)
  }
  if (await serviceRunning(path.join(root, 'service.json'))) {
    throw new Error('The existing capture instance is running; quit Markover before resetting it.')
  }
}

function safeCaptureRoot(value: string): string {
  const root = path.resolve(value)
  if (
    !path.isAbsolute(value) ||
    !path.basename(root).startsWith('markover-public-capture') ||
    root === path.parse(root).root
  ) {
    throw new Error(`Unsafe capture root: ${value}`)
  }
  return root
}

async function writeSource(
  physicalRoot: string,
  relativePath: string,
  source: string
): Promise<void> {
  const filePath = path.join(physicalRoot, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, source, 'utf8')
}

async function createRepository({
  branch,
  logicalRoot,
  name,
  remote,
  sources
}: Omit<CaptureRepository, 'commit'>, physicalRoot: string): Promise<CaptureRepository> {
  await fs.mkdir(physicalRoot, { recursive: true })
  for (const [relativePath, source] of Object.entries(sources)) {
    await writeSource(physicalRoot, relativePath, source)
  }
  command(physicalRoot, 'git', ['init', '--quiet', `--initial-branch=${branch}`])
  command(physicalRoot, 'git', ['config', 'user.name', 'Markover Capture'])
  command(physicalRoot, 'git', ['config', 'user.email', 'capture@example.invalid'])
  command(physicalRoot, 'git', ['remote', 'add', 'origin', remote])
  command(physicalRoot, 'git', ['add', '.'])
  const gitEnvironment = {
    ...process.env,
    GIT_AUTHOR_DATE: fixtureTimestamp,
    GIT_COMMITTER_DATE: fixtureTimestamp
  }
  command(
    physicalRoot,
    'git',
    ['commit', '--quiet', '-m', `Seed ${name} capture fixture`],
    gitEnvironment
  )
  return {
    branch,
    commit: command(physicalRoot, 'git', ['rev-parse', 'HEAD']),
    logicalRoot,
    name,
    remote,
    sources
  }
}

function attachmentSvg(title: string, accent: string, detail: string): Buffer {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
  <rect width="720" height="420" rx="24" fill="#f7f4ee"/>
  <rect x="36" y="36" width="648" height="348" rx="18" fill="#fffdf9" stroke="#ddd5cc" stroke-width="2"/>
  <rect x="72" y="82" width="14" height="184" rx="7" fill="${accent}"/>
  <text x="112" y="128" fill="#26211e" font-family="-apple-system, BlinkMacSystemFont, system-ui, sans-serif" font-size="34" font-weight="650">${title}</text>
  <text x="112" y="178" fill="#6f6761" font-family="-apple-system, BlinkMacSystemFont, system-ui, sans-serif" font-size="22">${detail}</text>
  <rect x="112" y="222" width="468" height="18" rx="9" fill="#ece9e2"/>
  <rect x="112" y="258" width="382" height="18" rx="9" fill="#ece9e2"/>
  <rect x="112" y="310" width="156" height="38" rx="10" fill="#f5e3da" stroke="${accent}"/>
</svg>\n`, 'utf8')
}

function nodeByText(tree: ReviewTree, text: string): ReviewNode {
  let match: ReviewNode | null = null
  visitNodes(tree.root, (node) => {
    if (!match && node.text.includes(text)) match = node
  })
  if (!match) throw new Error(`Capture fixture node not found: ${text}`)
  return match
}

function supportingSource(title: string, paragraphs: string[]): string {
  return [
    `# ${title}`,
    '',
    ...paragraphs.flatMap((paragraph) => [paragraph, ''])
  ].join('\n')
}

async function createT3TitleDatabase(
  physicalPath: string,
  titles: Array<{ id: string; title: string }>
): Promise<void> {
  await fs.mkdir(path.dirname(physicalPath), { recursive: true })
  const database = new DatabaseSync(physicalPath)
  try {
    database.exec(`
      CREATE TABLE projection_threads (
        thread_id TEXT PRIMARY KEY,
        title TEXT,
        deleted_at TEXT
      )
    `)
    const insert = database.prepare(`
      INSERT INTO projection_threads (thread_id, title, deleted_at)
      VALUES (?, ?, NULL)
    `)
    for (const title of titles) insert.run(title.id, title.title)
  } finally {
    database.close()
  }
}

function threadMetadata(threadId: string): ReviewAgentThread {
  return {
    id: `agent_${threadId}`,
    threadHost: {
      kind: 't3code',
      provider: 'codex',
      threadId,
      machine: 'capture-mac'
    }
  }
}

async function seedReview(
  store: ReviewStore,
  definition: CaptureReviewDefinition,
  logicalRoot: string,
  physicalRoot: string
): Promise<ReviewArtifact> {
  const source = definition.project.sources[definition.document]
  if (source === undefined) throw new Error(`Missing fixture source ${definition.document}.`)
  const logicalPath = path.join(definition.project.logicalRoot, definition.document)
  const tree = parseMarkdown(source, reviewChecksum(source), {
    name: definition.document,
    path: logicalPath
  })

  if (definition.id === captureReviewIds[0]) {
    const heading = nodeByText(tree, 'Launch readiness brief')
    const criteria = nodeByText(tree, 'Success criteria')
    const table = nodeByText(tree, 'Signal | Ready when')
    const code = nodeByText(tree, 'await openReview')
    const opening = nodeByText(tree, 'Ship the review pilot')
    heading.feedback = '**Tighten the opening before the pilot.** Compare [!img-1] with [!img-2] and name the audience explicitly.'
    criteria.feedback = 'Make the met, blocked, and deferred signals measurable before the pilot expands.'
    table.feedback = 'Keep the manual-file workflow visible here so the launch brief does not imply automation we have not shipped.'
    code.feedback = 'Explain why this retry is idempotent and what the agent should retain between attempts.'
    opening.sourceEdit = {
      original: opening.raw,
      current: 'Ship a focused pilot to the design-partner group, then expand only after the review loop is reliable and every handoff names an owner.'
    }
  } else {
    nodeByText(tree, definition.document === 'release-notes.md'
      ? 'Release notes'
      : definition.document === 'participant-guide.md'
        ? 'Participant guide'
        : definition.document === 'interview-synthesis.md'
          ? 'Interview synthesis'
          : 'Review protocol').feedback = definition.status === 'editing'
      ? 'Clarify the next action and name the person who owns it.'
      : 'This handoff is with the agent; keep the supporting evidence attached.'
  }

  const artifact = await store.create({
    tree,
    contextSummary: definition.contextSummary,
    agentThread: threadMetadata(definition.threadId),
    git: {
      repositoryUrl: definition.project.remote,
      branch: definition.branch,
      commit: definition.project.commit
    },
    pullRequest: {
      number: definition.pullRequestNumber,
      url: `${definition.project.remote.replace(/\.git$/, '')}/pull/${String(definition.pullRequestNumber)}`
    },
    pullRequestStatus: 'open'
  })

  if (definition.id === captureReviewIds[0]) {
    const first = await store.saveAttachmentFile(
      artifact.review.id,
      'svg',
      attachmentSvg('Workflow overview', '#c94e1f', 'Open → annotate → hand off')
    )
    const second = await store.saveAttachmentFile(
      artifact.review.id,
      'svg',
      attachmentSvg('Annotation details', '#6d211f', 'Block-level feedback with evidence')
    )
    const current = await store.load(artifact.review.id)
    const heading = findNode(current.root, nodeByText(tree, 'Launch readiness brief').id)
    if (!heading) throw new Error('Primary capture heading is unavailable.')
    heading.attachments = [
      {
        id: first.id,
        type: 'image',
        label: 'workflow overview',
        path: path.join(logicalRoot, path.relative(physicalRoot, first.path)),
        mimeType: 'image/svg+xml'
      },
      {
        id: second.id,
        type: 'image',
        label: 'annotation details',
        path: path.join(logicalRoot, path.relative(physicalRoot, second.path)),
        mimeType: 'image/svg+xml'
      }
    ]
    await store.updateTree(artifact.review.id, current)
  }
  if (definition.status === 'pending-agent') {
    return store.transition(artifact.review.id, 'pending-agent', 'open')
  }
  return store.load(artifact.review.id)
}

function reviewViewState(selectedBlockId: string | null): WorkspaceReviewViewState {
  return {
    selectedBlockId,
    annotatedOnly: false,
    annotationView: 'selected',
    sourceCollapsed: false,
    collapsedBlockIds: []
  }
}

async function fixtureRepositories(
  physicalRoot: string,
  logicalRoot: string,
  launchBriefSource: string
): Promise<CaptureRepository[]> {
  const definitions = [
    {
      name: 'atlas-studio',
      branch: 'feature/review-pilot',
      remote: 'https://github.com/markover-demo/atlas-studio.git',
      sources: {
        'launch-readiness.md': launchBriefSource,
        'release-notes.md': supportingSource('Release notes', [
          'Describe the focused preview without implying signing, notarization, or Intel support.',
          'Link every claim to the tested release evidence.'
        ])
      }
    },
    {
      name: 'field-research',
      branch: 'research/pilot-notes',
      remote: 'https://github.com/markover-demo/field-research.git',
      sources: {
        'participant-guide.md': supportingSource('Participant guide', [
          'Invite design partners to review one short Markdown brief.',
          'Ask participants to label screenshots before returning feedback.'
        ]),
        'interview-synthesis.md': supportingSource('Interview synthesis', [
          'The document tree kept long review sessions oriented.',
          'Participants wanted the handoff owner visible at every step.'
        ])
      }
    },
    {
      name: 'review-protocol',
      branch: 'docs/structured-handoff',
      remote: 'https://github.com/markover-demo/review-protocol.git',
      sources: {
        'review-protocol.md': supportingSource('Review protocol', [
          'Open once, retain the review ID, and stop for human feedback.',
          'Retrieve the complete handoff before revising the source.'
        ])
      }
    }
  ]
  const repositories: CaptureRepository[] = []
  for (const definition of definitions) {
    const repositoryPhysicalRoot = path.join(physicalRoot, 'projects', definition.name)
    const repositoryLogicalRoot = path.join(logicalRoot, 'projects', definition.name)
    repositories.push(await createRepository({
      ...definition,
      logicalRoot: repositoryLogicalRoot
    }, repositoryPhysicalRoot))
  }
  return repositories
}

async function seedCaptureState(
  physicalRoot: string,
  logicalRoot: string,
  source: CaptureSource,
  generatedAt: Date,
  launchBriefSource: string
): Promise<CaptureSessionReceipt> {
  const repositories = await fixtureRepositories(
    physicalRoot,
    logicalRoot,
    launchBriefSource
  )
  const byName = new Map(repositories.map((repository) => [repository.name, repository]))
  const atlas = byName.get('atlas-studio') as CaptureRepository
  const field = byName.get('field-research') as CaptureRepository
  const protocol = byName.get('review-protocol') as CaptureRepository
  const definitions: CaptureReviewDefinition[] = [
    {
      id: captureReviewIds[0],
      project: atlas,
      document: 'launch-readiness.md',
      contextSummary: 'Prepare the Atlas Studio focused review pilot.',
      branch: atlas.branch,
      pullRequestNumber: 42,
      status: 'editing',
      threadId: 'thread_public_atlas',
      threadTitle: 'Shape the focused review pilot'
    },
    {
      id: captureReviewIds[1],
      project: atlas,
      document: 'release-notes.md',
      contextSummary: 'Check focused-preview release language.',
      branch: atlas.branch,
      pullRequestNumber: 42,
      status: 'pending-agent',
      threadId: 'thread_public_atlas',
      threadTitle: 'Shape the focused review pilot'
    },
    {
      id: captureReviewIds[2],
      project: field,
      document: 'participant-guide.md',
      contextSummary: 'Refine the design-partner participant guide.',
      branch: field.branch,
      pullRequestNumber: 18,
      status: 'editing',
      threadId: 'thread_public_research',
      threadTitle: 'Prepare design-partner research'
    },
    {
      id: captureReviewIds[3],
      project: field,
      document: 'interview-synthesis.md',
      contextSummary: 'Synthesize the first review interviews.',
      branch: field.branch,
      pullRequestNumber: 18,
      status: 'pending-agent',
      threadId: 'thread_public_research',
      threadTitle: 'Prepare design-partner research'
    },
    {
      id: captureReviewIds[4],
      project: protocol,
      document: 'review-protocol.md',
      contextSummary: 'Verify the structured handoff protocol.',
      branch: protocol.branch,
      pullRequestNumber: 7,
      status: 'editing',
      threadId: 'thread_public_protocol',
      threadTitle: 'Document the structured handoff'
    }
  ]
  const timestamps = definitions.map((_, index) => (
    new Date(generatedAt.getTime() - index * 18 * 60 * 1000).toISOString()
  ))
  let idIndex = 0
  let timeIndex = 0
  const store = new ReviewStore(path.join(physicalRoot, 'reviews'), {
    idFactory: () => captureReviewIds[idIndex++] as string,
    now: () => timestamps[Math.min(timeIndex++, timestamps.length - 1)] as string
  })
  const artifacts: ReviewArtifact[] = []
  for (const definition of definitions) {
    artifacts.push(await seedReview(store, definition, logicalRoot, physicalRoot))
  }

  const titleDatabasePath = path.join(physicalRoot, 'fixture', 't3.sqlite')
  await createT3TitleDatabase(titleDatabasePath, definitions.map((definition) => ({
    id: definition.threadId,
    title: definition.threadTitle
  })).filter((entry, index, entries) => (
    entries.findIndex(({ id }) => id === entry.id) === index
  )))
  const settings = new SettingsStore(path.join(physicalRoot, 'settings.json'))
  await settings.update({
    palette: 'ember',
    appearance: 'light',
    showKeyboardHelp: false,
    openLeftPane: true,
    incomingReviewActivationPolicy: 'never',
    reviewLinkActivationPolicy: 'never',
    discoverAgentThreadFromLocalSessions: false,
    remoteCanonicalGatewayEnabled: false,
    t3ThreadTitlesEnabled: true,
    t3MetadataDatabasePath: path.join(logicalRoot, 'fixture', 't3.sqlite'),
    codexThreadTitlesEnabled: false,
    claudeThreadTitlesEnabled: false,
    inboxTitlePreference: 'review-purpose'
  })

  const primary = artifacts[0] as ReviewArtifact
  const selectedHeading = nodeByText(primary, 'Launch readiness brief').id
  const projectKeys = repositories.map((repository) => (
    `remote:github.com/markover-demo/${repository.name}`
  ))
  const threadKeys = definitions.map((definition) => ({
    projectKey: `remote:github.com/markover-demo/${definition.project.name}`,
    threadKey: `t3code:${definition.threadId}`,
    expanded: true
  })).filter((entry, index, entries) => (
    entries.findIndex((candidate) => (
      candidate.projectKey === entry.projectKey && candidate.threadKey === entry.threadKey
    )) === index
  ))
  const workspace = new WorkspaceStore(path.join(physicalRoot, 'workspace.json'))
  await workspace.replace({
    format: 'markover-workspace',
    version: 3,
    initialized: true,
    navigationMode: 'inbox',
    projectExpansion: projectKeys.map((projectKey) => ({
      projectKey,
      expanded: true
    })),
    threadExpansion: threadKeys,
    activeReviewId: captureReviewIds[0],
    rightPaneWidth: 390,
    reviews: Object.fromEntries(captureReviewIds.map((reviewId) => [
      reviewId,
      reviewViewState(reviewId === captureReviewIds[0] ? selectedHeading : null)
    ]))
  })

  const receipt: CaptureSessionReceipt = {
    format: sessionFormat,
    version: 1,
    fixtureRevision: CAPTURE_FIXTURE_REVISION,
    commit: source.commit,
    dirty: false,
    generatedAt: generatedAt.toISOString(),
    stateRoot: logicalRoot,
    palette: 'ember',
    appearance: 'light',
    window: { width: 1180, height: 760 },
    reviewIds: [...captureReviewIds]
  }
  await fs.writeFile(
    path.join(physicalRoot, CAPTURE_SESSION_RECEIPT),
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8'
  )
  return receipt
}

async function textFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'objects') await visit(filePath)
      } else if (
        entry.isFile() &&
        /(?:\.json|\.md|\.svg|\.git\/(?:config|HEAD)|\/config|\/HEAD)$/.test(filePath)
      ) {
        files.push(filePath)
      }
    }
  }
  await visit(root)
  return files
}

export async function assertSanitizedCaptureState(
  root: string,
  forbiddenValues: readonly string[]
): Promise<void> {
  const needles = forbiddenValues.map((value) => value.trim()).filter((value) => (
    value.length >= 4 && value !== root
  ))
  for (const filePath of await textFiles(root)) {
    const source = await fs.readFile(filePath, 'utf8')
    for (const needle of needles) {
      if (source.includes(needle)) {
        throw new Error(`Private capture value found in ${path.relative(root, filePath)}.`)
      }
    }
  }
}

export async function prepareCaptureState({
  checkout,
  generatedAt = new Date(),
  root: requestedRoot = CAPTURE_ROOT,
  serviceRunning = defaultServiceRunning,
  source
}: PrepareCaptureOptions): Promise<PreparedCapture> {
  const root = safeCaptureRoot(requestedRoot)
  const resolvedCheckout = path.resolve(checkout)
  if (root === serviceDirectory() || root === developmentStateRoot(resolvedCheckout)) {
    throw new Error('Capture root must differ from canonical and development state.')
  }
  await fs.mkdir(path.dirname(root), { recursive: true })
  await assertResettableCaptureRoot(root, serviceRunning)
  const stagingRoot = await fs.mkdtemp(path.join(
    path.dirname(root),
    `.${path.basename(root)}-stage-`
  ))
  try {
    await fs.writeFile(path.join(stagingRoot, CAPTURE_ROOT_MARKER), captureMarker(), {
      encoding: 'utf8',
      mode: 0o600
    })
    const launchBriefSource = await fs.readFile(path.join(
      resolvedCheckout,
      'doc',
      'launch',
      'issue-16',
      'launch-brief.md'
    ), 'utf8')
    const receipt = await seedCaptureState(
      stagingRoot,
      root,
      source,
      generatedAt,
      launchBriefSource
    )
    await assertSanitizedCaptureState(stagingRoot, [
      os.homedir(),
      resolvedCheckout,
      developmentStateRoot(resolvedCheckout),
      serviceDirectory(),
      ...sessionEnvironmentKeys.flatMap((key) => process.env[key] || [])
    ])
    if (await pathExists(root)) {
      await fs.rm(root, { recursive: true, force: true })
    }
    await fs.rename(stagingRoot, root)
    const instance = captureResolvedInstance(resolvedCheckout, root)
    if (!parseResolvedInstance(instance)) {
      throw new Error('The capture instance contract is invalid.')
    }
    return { instance, receipt }
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true })
  }
}

export function captureLaunchEnvironment(
  instance: ResolvedInstance,
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    [RESOLVED_INSTANCE_ENVIRONMENT]: resolvedInstanceEnvironment(instance),
    [SUPPRESS_PROTOCOL_REGISTRATION_ENVIRONMENT]: '1'
  }
  delete childEnvironment.ELECTRON_RUN_AS_NODE
  for (const key of sessionEnvironmentKeys) delete childEnvironment[key]
  return childEnvironment
}

async function main(args = process.argv.slice(2)): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Public media capture requires macOS.')
  }
  const unknown = args.filter((argument) => argument !== '--prepare-only')
  if (unknown.length) throw new Error(`Unknown capture argument: ${unknown[0] as string}`)
  const checkout = path.resolve(__dirname, '../..')
  const prepared = await prepareCaptureState({
    checkout,
    source: captureSource(checkout)
  })
  process.stdout.write(`${JSON.stringify(prepared.receipt)}\n`)
  if (args.includes('--prepare-only')) return
  await buildAddressedDevelopmentBundle(prepared.instance)
  const executable = addressedDevelopmentExecutable(prepared.instance)
  const { spawn } = await import('node:child_process')
  const child = spawn(executable, [], {
    env: captureLaunchEnvironment(prepared.instance),
    stdio: 'inherit'
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 0
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal))
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover capture: ${message}\n`)
    process.exitCode = 1
  })
}
