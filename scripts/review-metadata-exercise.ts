import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  buildEvidenceFixture,
  parseMetadataMatrix,
  type CaptureObservation,
  type MetadataMatrix
} from './review-metadata-conformance'

type IdentityRoute = 'explicit-runtime' | 'handoff-key'
type JsonRecord = Record<string, unknown>

interface ExerciseState {
  entryId: string
  handoffKey: string | null
  limitations: string[]
  routes: IdentityRoute[]
  runtime: CaptureObservation['runtime']
  threadHostThreadId: string | null
}

interface ExerciseDependencies {
  environment: NodeJS.ProcessEnv
  hostname(): string | null
  now(): Date
  openReview(args: string[]): unknown
  randomBytes(size: number): Buffer
  retrieveReview(reviewId: string): unknown
}

const projectRoot = path.resolve(__dirname, '../..')
const sourcePath = path.join(projectRoot, 'evals/review-metadata/exercise-source.md')
const runIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{12}$/

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredOption(args: string[], name: string): string {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}

function optionalOption(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index === -1) return null
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}

function repeatedOptions(args: string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`)
    values.push(value)
  }
  return values
}

function parseRoutes(value: string | null, entryRoutes: IdentityRoute[]): IdentityRoute[] {
  if (value === null) return [...entryRoutes]
  const routes = value.split(',').map((route) => route.trim()).filter(Boolean)
  if (routes.length === 0 || routes.some((route) => (
    route !== 'explicit-runtime' && route !== 'handoff-key'
  ))) {
    throw new Error('--routes must be explicit-runtime, handoff-key, or both.')
  }
  const selected = [...new Set(routes)] as IdentityRoute[]
  const undeclared = selected.find((route) => !entryRoutes.includes(route))
  if (undeclared !== undefined) {
    throw new Error(
      `${undeclared} is not declared for this matrix entry; update the matrix before preparing it.`
    )
  }
  return selected
}

function nullableRuntime(value: string | null): {
  value: string | null
  source: 'runtime-context' | 'not-exposed'
} {
  const normalized = value?.trim() || null
  return {
    value: normalized,
    source: normalized === null ? 'not-exposed' : 'runtime-context'
  }
}

function writePrivate(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  fs.chmodSync(path.dirname(filePath), 0o700)
  fs.writeFileSync(filePath, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function readMatrix(root = projectRoot): MetadataMatrix {
  return parseMetadataMatrix(JSON.parse(fs.readFileSync(
    path.join(root, 'evals/review-metadata/matrix.json'),
    'utf8'
  )) as unknown)
}

function matrixEntry(matrix: MetadataMatrix, entryId: string) {
  const entry = matrix.entries.find((candidate) => candidate.id === entryId)
  if (entry === undefined) throw new Error(`Unknown metadata matrix entry: ${entryId}.`)
  return entry
}

function commandResult(command: string, args: string[]): unknown {
  const result = childProcess.spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  })
  if (result.status !== 0) throw new Error('Markover exercise command failed.')
  return JSON.parse(result.stdout) as unknown
}

function defaultDependencies(): ExerciseDependencies {
  const markoverScript = path.join(projectRoot, 'build/scripts/markover.js')
  return {
    environment: process.env,
    hostname: () => {
      const result = childProcess.spawnSync('/bin/hostname', [], {
        encoding: 'utf8',
        maxBuffer: 1024
      })
      return result.status === 0 ? result.stdout.trim() || null : null
    },
    now: () => new Date(),
    openReview: (args) => commandResult(process.execPath, [markoverScript, 'open', ...args]),
    randomBytes: (size) => crypto.randomBytes(size),
    retrieveReview: (reviewId) => commandResult(
      process.execPath,
      [markoverScript, 'get', reviewId]
    )
  }
}

function sessionEnvironmentName(provider: string): 'CLAUDE_CODE_SESSION_ID' | 'CODEX_THREAD_ID' {
  const normalized = provider.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalized === 'claude' || normalized === 'anthropic' || normalized === 'claudeagent') {
    return 'CLAUDE_CODE_SESSION_ID'
  }
  if (normalized === 'codex' || normalized === 'openai') return 'CODEX_THREAD_ID'
  throw new Error(`No explicit runtime variable is defined for provider ${provider}.`)
}

function reviewId(value: unknown): string {
  if (!isRecord(value) || typeof value.reviewId !== 'string' || !value.reviewId.trim()) {
    throw new Error('Markover open returned an invalid result.')
  }
  return value.reviewId
}

function storedReviewId(filePath: string): string {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  return reviewId(value)
}

function storedEvidenceId(filePath: string): string {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  if (!isRecord(value) || typeof value.evidenceId !== 'string' || !value.evidenceId.trim()) {
    throw new Error('Stored metadata observation is invalid.')
  }
  return value.evidenceId
}

function evidenceId(entryId: string, route: IdentityRoute, now: Date, suffix: string): string {
  const date = now.toISOString().slice(0, 10)
  const routeName = route === 'explicit-runtime' ? 'explicit' : 'handoff'
  return `${date}__${entryId}-${routeName}__${suffix}`
}

function pathForRun(root: string, runId: string): string {
  if (!runIdPattern.test(runId)) throw new Error('Invalid metadata exercise run ID.')
  return path.join(root, 'tmp/review-metadata/runs', runId)
}

export function prepareMetadataExercise(
  args: string[],
  options: { root?: string; randomBytes?: (size: number) => Buffer } = {}
): { captureCommand: string; handoffMarker: string | null; ok: true; runId: string } {
  const root = options.root ?? projectRoot
  const randomBytes = options.randomBytes ?? crypto.randomBytes
  const matrix = readMatrix(root)
  const entryId = requiredOption(args, '--entry')
  const entry = matrixEntry(matrix, entryId)
  const routes = parseRoutes(optionalOption(args, '--routes'), entry.requiredIdentityRoutes)
  const threadHostThreadId = optionalOption(args, '--thread-host-thread-id')?.trim() || null
  const hostVersion = nullableRuntime(optionalOption(args, '--host-version'))
  const providerVersion = nullableRuntime(optionalOption(args, '--provider-version'))
  const providerModel = nullableRuntime(optionalOption(args, '--provider-model'))
  const handoffKey = routes.includes('handoff-key')
    ? `mko_handoff_${randomBytes(24).toString('hex')}`
    : null
  const runId = `${entryId}-${randomBytes(6).toString('hex')}`
  const state: ExerciseState = {
    entryId,
    handoffKey,
    limitations: repeatedOptions(args, '--limitation'),
    routes,
    runtime: {
      hostVersion: hostVersion.value,
      hostVersionSource: hostVersion.source,
      providerModel: providerModel.value,
      providerModelSource: providerModel.source,
      providerVersion: providerVersion.value,
      providerVersionSource: providerVersion.source
    },
    threadHostThreadId
  }
  const directory = pathForRun(root, runId)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  writePrivate(path.join(directory, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
  return {
    captureCommand: `${shellQuote(process.execPath)} ${shellQuote(path.join(
      root,
      'build/scripts/review-metadata-exercise.js'
    ))} capture --run ${runId}`,
    handoffMarker: handoffKey,
    ok: true,
    runId
  }
}

export function captureMetadataExercise(
  runId: string,
  options: { dependencies?: ExerciseDependencies; root?: string } = {}
): {
  captures: Array<{
    evidenceId: string
    paths: { fixture: string; observation: string; rawReview: string }
    route: IdentityRoute
  }>
  ok: true
  runId: string
} {
  const root = options.root ?? projectRoot
  const dependencies = options.dependencies ?? defaultDependencies()
  const directory = pathForRun(root, runId)
  const state = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')) as ExerciseState
  const matrix = readMatrix(root)
  const entry = matrixEntry(matrix, state.entryId)
  const machine = dependencies.hostname()
  const captures = []
  for (const route of state.routes) {
    const routeDirectory = path.join(directory, route)
    const openedPath = path.join(routeDirectory, 'opened.json')
    const rawReviewPath = path.join(routeDirectory, 'raw-review.json')
    const observationPath = path.join(routeDirectory, 'observation.json')
    const fixturePath = path.join(routeDirectory, 'fixture.json')
    if (fs.existsSync(fixturePath)) {
      if (!fs.existsSync(rawReviewPath) || !fs.existsSync(observationPath)) {
        throw new Error(`The ${route} capture bundle is incomplete.`)
      }
      captures.push({
        evidenceId: storedEvidenceId(observationPath),
        paths: {
          fixture: path.relative(root, fixturePath),
          observation: path.relative(root, observationPath),
          rawReview: path.relative(root, rawReviewPath)
        },
        route
      })
      continue
    }
    const identityArgs: string[] = []
    if (route === 'explicit-runtime') {
      const environmentName = sessionEnvironmentName(entry.threadHost.provider)
      const threadId = dependencies.environment[environmentName]?.trim()
      if (!threadId) throw new Error(`${environmentName} is unavailable for the explicit route.`)
      identityArgs.push('--thread-id', threadId)
    } else {
      if (state.handoffKey === null) throw new Error('The prepared handoff key is unavailable.')
      identityArgs.push('--handoff-key', state.handoffKey)
    }
    const hostArgs = [
      '--thread-host-kind', entry.threadHost.kind,
      '--thread-host-provider', entry.threadHost.provider
    ]
    if (state.threadHostThreadId !== null) {
      hostArgs.push('--thread-host-thread-id', state.threadHostThreadId)
    }
    if (machine !== null) hostArgs.push('--thread-host-machine', machine)
    let artifact: unknown
    if (fs.existsSync(rawReviewPath)) {
      artifact = JSON.parse(fs.readFileSync(rawReviewPath, 'utf8')) as unknown
    } else {
      let openedId: string
      if (fs.existsSync(openedPath)) {
        openedId = storedReviewId(openedPath)
      } else {
        const opened = dependencies.openReview([
          sourcePath,
          '--summary', `${entry.hostProduct} × ${entry.providerProduct} metadata ${route}`,
          ...identityArgs,
          ...hostArgs
        ])
        openedId = reviewId(opened)
        writePrivate(openedPath, `${JSON.stringify({ reviewId: openedId }, null, 2)}\n`)
      }
      artifact = dependencies.retrieveReview(openedId)
      writePrivate(rawReviewPath, `${JSON.stringify(artifact, null, 2)}\n`)
    }
    let observation: CaptureObservation
    if (fs.existsSync(observationPath)) {
      observation = JSON.parse(fs.readFileSync(observationPath, 'utf8')) as CaptureObservation
    } else {
      const suffix = dependencies.randomBytes(4).toString('hex')
      observation = {
        discovery: {
          hostKind: { source: 'thread-context', status: 'observed' },
          hostProvider: { source: 'thread-context', status: 'observed' },
          hostThreadId: state.threadHostThreadId === null
            ? { source: 'not-exposed', status: 'unavailable' }
            : { source: 'thread-host-runtime', status: 'observed' },
          machine: machine === null
            ? { source: 'not-exposed', status: 'unavailable' }
            : { source: 'hostname-command', status: 'observed' },
          providerThreadId: {
            source: route === 'explicit-runtime' ? 'agent-runtime' : 'local-session-handoff',
            status: 'observed'
          }
        },
        evidenceId: evidenceId(state.entryId, route, dependencies.now(), suffix),
        exercisedAt: dependencies.now().toISOString(),
        identityRoute: route,
        limitations: state.limitations,
        matrixEntryId: state.entryId,
        runtime: state.runtime,
        schemaVersion: 2,
        truthfulnessAttested: true
      }
      writePrivate(observationPath, `${JSON.stringify(observation, null, 2)}\n`)
    }
    const fixture = buildEvidenceFixture(artifact, observation, matrix)
    writePrivate(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`)
    captures.push({
      evidenceId: observation.evidenceId,
      paths: {
        fixture: path.relative(root, fixturePath),
        observation: path.relative(root, observationPath),
        rawReview: path.relative(root, rawReviewPath)
      },
      route
    })
  }
  return { captures, ok: true, runId }
}

function main(): void {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'prepare') {
    process.stdout.write(`${JSON.stringify(prepareMetadataExercise(args))}\n`)
    return
  }
  if (command === 'capture') {
    process.stdout.write(`${JSON.stringify(captureMetadataExercise(
      requiredOption(args, '--run')
    ))}\n`)
    return
  }
  throw new Error(
    'Usage: review-metadata-exercise <prepare --entry ID [--routes ROUTES] [--thread-host-thread-id ID] [--host-version VERSION] [--provider-version VERSION] [--provider-model MODEL] [--limitation TEXT] | capture --run RUN_ID>'
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
