import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { probeService } from './local-client'
import {
  serviceDirectory,
  serviceEndpointPath,
  serviceTokenPath,
  type ServiceDirectoryOptions
} from './service-endpoint'

export const CANONICAL_INSTANCE_KEY = 'canonical'
export const CANONICAL_INSTANCE_SCHEME = 'markover'
export const CANONICAL_DESCRIPTOR_NAME = 'canonical-instance.json'
export const RUNTIME_INSTANCE_NAME = 'addressed-instance.json'

export type PullRequestState = 'open' | 'closed' | 'merged' | 'unknown'
export type ColdStartBlock =
  | 'already-running'
  | 'canonical-descriptor-missing'
  | 'canonical-checkout-invalid'
  | 'pull-request-closed'
  | 'pull-request-merged'

export interface CanonicalInstanceDescriptor {
  version: 1
  checkout: string
  blessedBranch: string
}

export interface CanonicalInstanceIdentity {
  kind: 'canonical'
  key: typeof CANONICAL_INSTANCE_KEY
}

export interface DevelopmentInstanceIdentity {
  kind: 'development'
  key: `pr-${number}`
  pullRequestNumber: number
}

export type AddressedInstanceIdentity =
  | CanonicalInstanceIdentity
  | DevelopmentInstanceIdentity

export interface InstanceBranding {
  appName: string
  headerBadge: string | null
  iconLabel: string | null
  iconSvgPath: string
  iconPngPath: string
  iconIcnsPath: string
}

export interface ResolvedInstance {
  version: 1
  identity: AddressedInstanceIdentity
  stateRoot: string
  checkout: string | null
  service: {
    root: string
    endpointPath: string
    tokenPath: string
    singleInstanceLockRoot: string
  }
  scheme: string
  process: {
    status: 'running' | 'stopped'
  }
  coldStart: {
    eligible: boolean
    blockedBy: ColdStartBlock | null
  }
  branding: InstanceBranding
  pullRequest: {
    number: number
    state: PullRequestState
  } | null
}

export interface PullRequestInspection {
  number: number
  state: Exclude<PullRequestState, 'unknown'>
}

export type PullRequestLookup = (
  checkout: string
) => Promise<PullRequestInspection>

export type ServiceProbe = (endpointPath: string) => Promise<boolean>

export interface ResolveInstanceOptions extends ServiceDirectoryOptions {
  canonicalDescriptorPath?: string
  checkoutDirectory?: string
  expectedPullRequestNumber?: number
  inspectPullRequest?: PullRequestLookup
  probe?: ServiceProbe
}

export class InstanceResolutionError extends Error {
  readonly code:
    | 'CANONICAL_DESCRIPTOR_INVALID'
    | 'DEVELOPMENT_INSTANCE_IDENTITY_MISSING'
    | 'INSTANCE_IDENTITY_MISMATCH'
    | 'NO_PULL_REQUEST'
    | 'PULL_REQUEST_VERIFICATION_UNAVAILABLE'

  constructor(
    code: InstanceResolutionError['code'],
    message: string
  ) {
    super(message)
    this.name = 'InstanceResolutionError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function normalizedBranch(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function canonicalDescriptorPath(
  options?: ServiceDirectoryOptions
): string {
  return path.join(serviceDirectory(options), CANONICAL_DESCRIPTOR_NAME)
}

export function developmentStateRoot(checkout: string): string {
  return path.join(path.resolve(checkout), '.markover', 'instance')
}

export function developmentGeneratedRoot(checkout: string): string {
  return path.join(path.resolve(checkout), '.markover', 'generated')
}

export function runtimeInstancePath(stateRoot: string): string {
  return path.join(stateRoot, RUNTIME_INSTANCE_NAME)
}

export function parseCanonicalInstanceDescriptor(
  value: unknown
): CanonicalInstanceDescriptor | null {
  if (!isRecord(value) || value.version !== 1) return null
  const checkout = typeof value.checkout === 'string'
    ? path.normalize(value.checkout)
    : ''
  const blessedBranch = normalizedBranch(value.blessedBranch)
  if (!path.isAbsolute(checkout) || !blessedBranch) return null
  return { version: 1, checkout, blessedBranch }
}

export function parseRuntimeInstanceIdentity(
  value: unknown
): AddressedInstanceIdentity | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (value.kind === 'canonical' && value.key === CANONICAL_INSTANCE_KEY) {
    return { kind: 'canonical', key: CANONICAL_INSTANCE_KEY }
  }
  if (
    value.kind !== 'development' ||
    !positiveInteger(value.pullRequestNumber) ||
    value.key !== `pr-${String(value.pullRequestNumber)}`
  ) return null
  return {
    kind: 'development',
    key: `pr-${value.pullRequestNumber}`,
    pullRequestNumber: value.pullRequestNumber
  }
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    const code: unknown = error !== null && typeof error === 'object'
      ? Reflect.get(error, 'code')
      : null
    if (code === 'ENOENT') return null
    return null
  }
}

async function defaultProbe(endpointPath: string): Promise<boolean> {
  try {
    await probeService(endpointPath)
    return true
  } catch {
    return false
  }
}

function commandFailure(result: ReturnType<typeof spawnSync>): string {
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  return stderr || stdout || `command exited ${String(result.status ?? 1)}`
}

export async function inspectCurrentPullRequest(
  checkout: string
): Promise<PullRequestInspection> {
  const result = await Promise.resolve().then(() => spawnSync(
    'gh',
    ['pr', 'view', '--json', 'number,state'],
    { cwd: checkout, encoding: 'utf8' }
  ))
  if (result.error) {
    throw new InstanceResolutionError(
      'PULL_REQUEST_VERIFICATION_UNAVAILABLE',
      `Could not verify the development pull request: ${result.error.message}`
    )
  }
  if (result.status !== 0) {
    const failure = commandFailure(result)
    const noPullRequest = /no pull requests found|no pull request found/i.test(failure)
    throw new InstanceResolutionError(
      noPullRequest ? 'NO_PULL_REQUEST' : 'PULL_REQUEST_VERIFICATION_UNAVAILABLE',
      noPullRequest
        ? 'This checkout does not have a pull request. Development instances require an open pull request.'
        : `Could not verify the development pull request: ${failure}`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout) as unknown
  } catch {
    throw new InstanceResolutionError(
      'PULL_REQUEST_VERIFICATION_UNAVAILABLE',
      'GitHub returned an invalid pull-request response.'
    )
  }
  if (!isRecord(parsed) || !positiveInteger(parsed.number)) {
    throw new InstanceResolutionError(
      'NO_PULL_REQUEST',
      'This checkout does not have a pull request. Development instances require an open pull request.'
    )
  }
  const state = typeof parsed.state === 'string'
    ? parsed.state.toLowerCase()
    : ''
  if (state !== 'open' && state !== 'closed' && state !== 'merged') {
    throw new InstanceResolutionError(
      'PULL_REQUEST_VERIFICATION_UNAVAILABLE',
      `GitHub returned an unknown pull-request state: ${String(parsed.state)}`
    )
  }
  return { number: parsed.number, state }
}

function assertExpectedPullRequest(
  identity: DevelopmentInstanceIdentity,
  expectedPullRequestNumber: number | undefined
): void {
  if (
    expectedPullRequestNumber !== undefined &&
    identity.pullRequestNumber !== expectedPullRequestNumber
  ) {
    throw new InstanceResolutionError(
      'INSTANCE_IDENTITY_MISMATCH',
      `This checkout resolves to PR ${String(identity.pullRequestNumber)}, not PR ${String(expectedPullRequestNumber)}.`
    )
  }
}

function developmentIdentity(
  pullRequestNumber: number
): DevelopmentInstanceIdentity {
  return {
    kind: 'development',
    key: `pr-${pullRequestNumber}`,
    pullRequestNumber
  }
}

function canonicalBranding(): InstanceBranding {
  return {
    appName: 'Markover',
    headerBadge: null,
    iconLabel: null,
    iconSvgPath: 'design/brand/markover-app-icon.svg',
    iconPngPath: 'design/brand/markover-app-icon.png',
    iconIcnsPath: 'design/brand/markover-app-icon.icns'
  }
}

function developmentBranding(
  checkout: string,
  pullRequestNumber: number
): InstanceBranding {
  const label = String(pullRequestNumber)
  const generatedRoot = path.join(
    developmentGeneratedRoot(checkout),
    `pr-${label}`
  )
  return {
    appName: `Markover-${label}`,
    headerBadge: `PR ${label}`,
    iconLabel: label,
    iconSvgPath: path.join(generatedRoot, 'markover-app-icon.svg'),
    iconPngPath: path.join(generatedRoot, 'markover-app-icon.png'),
    iconIcnsPath: path.join(generatedRoot, 'markover-app-icon.icns')
  }
}

function serviceContract(root: string): ResolvedInstance['service'] {
  return {
    root,
    endpointPath: path.join(root, 'service.json'),
    tokenPath: path.join(root, 'service.token'),
    singleInstanceLockRoot: root
  }
}

async function canonicalCheckoutIsValid(
  descriptor: CanonicalInstanceDescriptor
): Promise<boolean> {
  try {
    const stats = await fs.stat(descriptor.checkout)
    if (!stats.isDirectory()) return false
  } catch {
    return false
  }
  const root = spawnSync(
    'git',
    ['rev-parse', '--show-toplevel'],
    { cwd: descriptor.checkout, encoding: 'utf8' }
  )
  const branch = spawnSync(
    'git',
    ['branch', '--show-current'],
    { cwd: descriptor.checkout, encoding: 'utf8' }
  )
  const [resolvedRoot, resolvedCheckout] = root.status === 0
    ? await Promise.all([
        fs.realpath(root.stdout.trim()),
        fs.realpath(descriptor.checkout)
      ])
    : ['', '']
  return root.status === 0 &&
    resolvedRoot === resolvedCheckout &&
    branch.status === 0 &&
    branch.stdout.trim() === descriptor.blessedBranch
}

async function resolveCanonicalInstance(
  options: ResolveInstanceOptions
): Promise<ResolvedInstance> {
  const directoryOptions: ServiceDirectoryOptions = {
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.homeDirectory === undefined
      ? {}
      : { homeDirectory: options.homeDirectory }),
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment })
  }
  const stateRoot = serviceDirectory(directoryOptions)
  const endpointPath = serviceEndpointPath(directoryOptions)
  const tokenPath = serviceTokenPath(directoryOptions)
  const probe = options.probe || defaultProbe
  const running = await probe(endpointPath)
  const descriptorFile = options.canonicalDescriptorPath ||
    canonicalDescriptorPath(directoryOptions)
  const rawDescriptor = await readJson(descriptorFile)
  const descriptor = parseCanonicalInstanceDescriptor(rawDescriptor)
  const validCheckout = descriptor
    ? await canonicalCheckoutIsValid(descriptor)
    : false
  const blockedBy: ColdStartBlock | null = running
    ? 'already-running'
    : !rawDescriptor
        ? 'canonical-descriptor-missing'
        : !descriptor || !validCheckout
            ? 'canonical-checkout-invalid'
            : null
  return {
    version: 1,
    identity: { kind: 'canonical', key: CANONICAL_INSTANCE_KEY },
    stateRoot,
    checkout: descriptor?.checkout || null,
    service: {
      ...serviceContract(stateRoot),
      endpointPath,
      tokenPath
    },
    scheme: CANONICAL_INSTANCE_SCHEME,
    process: { status: running ? 'running' : 'stopped' },
    coldStart: { eligible: blockedBy === null, blockedBy },
    branding: canonicalBranding(),
    pullRequest: null
  }
}

async function resolveDevelopmentInstance(
  options: ResolveInstanceOptions
): Promise<ResolvedInstance> {
  const checkout = path.resolve(options.checkoutDirectory || process.cwd())
  const stateRoot = developmentStateRoot(checkout)
  const endpointPath = path.join(stateRoot, 'service.json')
  const probe = options.probe || defaultProbe
  const inspectPullRequest = options.inspectPullRequest ||
    inspectCurrentPullRequest
  const running = await probe(endpointPath)
  const runtimeIdentity = parseRuntimeInstanceIdentity(
    await readJson(runtimeInstancePath(stateRoot))
  )
  let identity = running && runtimeIdentity?.kind === 'development'
    ? runtimeIdentity
    : null
  let pullRequestState: PullRequestState = 'unknown'

  if (identity) {
    assertExpectedPullRequest(identity, options.expectedPullRequestNumber)
    try {
      const inspection = await inspectPullRequest(checkout)
      const inspectedIdentity = developmentIdentity(inspection.number)
      assertExpectedPullRequest(inspectedIdentity, identity.pullRequestNumber)
      pullRequestState = inspection.state
    } catch (error) {
      if (!running || (
        error instanceof InstanceResolutionError &&
        error.code === 'INSTANCE_IDENTITY_MISMATCH'
      )) throw error
    }
  } else {
    if (running) {
      throw new InstanceResolutionError(
        'DEVELOPMENT_INSTANCE_IDENTITY_MISSING',
        `The running development instance is missing ${RUNTIME_INSTANCE_NAME}; restart it from this checkout.`
      )
    }
    const inspection = await inspectPullRequest(checkout)
    identity = developmentIdentity(inspection.number)
    assertExpectedPullRequest(identity, options.expectedPullRequestNumber)
    pullRequestState = inspection.state
  }

  const blockedBy: ColdStartBlock | null = running
    ? 'already-running'
    : pullRequestState === 'closed'
        ? 'pull-request-closed'
        : pullRequestState === 'merged'
            ? 'pull-request-merged'
            : null
  return {
    version: 1,
    identity,
    stateRoot,
    checkout,
    service: serviceContract(stateRoot),
    scheme: `markover-${String(identity.pullRequestNumber)}`,
    process: { status: running ? 'running' : 'stopped' },
    coldStart: { eligible: blockedBy === null, blockedBy },
    branding: developmentBranding(checkout, identity.pullRequestNumber),
    pullRequest: {
      number: identity.pullRequestNumber,
      state: pullRequestState
    }
  }
}

export function resolveInstance(
  selector: 'canonical' | 'development',
  options: ResolveInstanceOptions = {}
): Promise<ResolvedInstance> {
  return selector === 'canonical'
    ? resolveCanonicalInstance(options)
    : resolveDevelopmentInstance(options)
}

export async function publishRuntimeInstanceIdentity(
  stateRoot: string,
  identity: AddressedInstanceIdentity
): Promise<void> {
  await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await fs.chmod(stateRoot, 0o700)
  const destination = runtimeInstancePath(stateRoot)
  const temporary = path.join(
    stateRoot,
    `.${RUNTIME_INSTANCE_NAME}-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
  )
  try {
    await fs.writeFile(temporary, `${JSON.stringify({
      version: 1,
      ...identity
    }, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    if (process.platform !== 'win32') await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, destination)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

export interface WriteCanonicalInstanceDescriptorOptions {
  destination?: string
  platform?: NodeJS.Platform
}

export async function writeCanonicalInstanceDescriptor(
  value: unknown,
  {
    destination = canonicalDescriptorPath(),
    platform = process.platform
  }: WriteCanonicalInstanceDescriptorOptions = {}
): Promise<CanonicalInstanceDescriptor> {
  const descriptor = parseCanonicalInstanceDescriptor(value)
  if (!descriptor) {
    throw new InstanceResolutionError(
      'CANONICAL_DESCRIPTOR_INVALID',
      'Canonical instance configuration requires an absolute checkout and a blessed branch.'
    )
  }
  const directory = path.dirname(destination)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  if (platform !== 'win32') await fs.chmod(directory, 0o700)
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
  )
  try {
    await fs.writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    if (platform !== 'win32') await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, destination)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
  return descriptor
}
