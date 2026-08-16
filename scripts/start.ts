import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  addressedDevelopmentExecutable,
  buildAddressedDevelopmentBundle
} from './development-bundle'
import { loadDevelopmentConfig } from '../src/development-config'
import {
  publishRuntimeInstanceIdentity,
  resolveInstance,
  resolvedInstanceEnvironment,
  RESOLVED_INSTANCE_ENVIRONMENT,
  type ResolvedInstance
} from '../src/instance'

const projectDirectory = path.resolve(__dirname, '../..')

export interface ParsedStartArguments {
  selector: 'canonical' | 'development' | null
  appArguments: string[]
}

export class StartArgumentError extends Error {
  readonly code = 'INVALID_START_ARGUMENT'

  constructor(message: string) {
    super(message)
    this.name = 'StartArgumentError'
  }
}

export function parseStartArguments(args: readonly string[]): ParsedStartArguments {
  let selector: ParsedStartArguments['selector'] = null
  const appArguments: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument !== '--instance') {
      if (argument !== undefined) appArguments.push(argument)
      continue
    }
    if (selector !== null) {
      throw new StartArgumentError('--instance may be specified only once.')
    }
    const value = args[index + 1]
    if (value !== 'canonical' && value !== 'dev') {
      throw new StartArgumentError('--instance requires canonical or dev.')
    }
    selector = value === 'dev' ? 'development' : 'canonical'
    index += 1
  }
  return { selector, appArguments }
}

async function defaultSelector(checkout: string): Promise<
  'canonical' | 'development'
> {
  const canonical = await resolveInstance('canonical')
  if (canonical.checkout) {
    const [configured, current] = await Promise.all([
      fs.realpath(canonical.checkout),
      fs.realpath(checkout)
    ])
    if (configured === current) return 'canonical'
  }
  return 'development'
}

export async function resolveStartInstance(
  parsed: ParsedStartArguments,
  checkout = projectDirectory
): Promise<ResolvedInstance> {
  const selector = parsed.selector || await defaultSelector(checkout)
  const instance = await resolveInstance(selector, selector === 'development'
    ? { checkoutDirectory: checkout }
    : {})
  if (
    instance.process.status === 'stopped' &&
    !instance.coldStart.eligible
  ) {
    throw new Error(
      `Cannot start ${instance.identity.key}: ${instance.coldStart.blockedBy || 'not eligible'}.`
    )
  }
  if (selector === 'canonical' && instance.process.status === 'stopped') {
    if (!instance.checkout) {
      throw new Error('The canonical checkout is not configured.')
    }
    const [configured, current] = await Promise.all([
      fs.realpath(instance.checkout),
      fs.realpath(checkout)
    ])
    if (configured !== current) {
      throw new Error(
        `The canonical instance must start from its configured checkout: ${instance.checkout}`
      )
    }
  }
  if (instance.identity.kind === 'development') {
    await loadDevelopmentConfig(checkout)
    await publishRuntimeInstanceIdentity(instance.stateRoot, instance.identity)
  }
  return instance
}

export type AddressedBundleBuilder = (
  instance: ResolvedInstance
) => Promise<unknown>

export async function prepareResolvedInstance(
  instance: ResolvedInstance,
  buildBundle: AddressedBundleBuilder = buildAddressedDevelopmentBundle
): Promise<void> {
  await buildBundle(instance)
}

export interface ResolvedLaunchTarget {
  args: string[]
  executable: string
}

export function resolvedLaunchTarget(
  instance: ResolvedInstance,
  appArguments: readonly string[]
): ResolvedLaunchTarget {
  return {
    executable: addressedDevelopmentExecutable(instance),
    args: [...appArguments]
  }
}

export interface LaunchResolvedInstanceOptions {
  detached?: boolean
  environment?: NodeJS.ProcessEnv
  ipc?: boolean
  spawnProcess?: typeof spawn
}

export function launchResolvedInstance(
  instance: ResolvedInstance,
  appArguments: readonly string[],
  {
    detached = false,
    environment = process.env,
    ipc = false,
    spawnProcess = spawn
  }: LaunchResolvedInstanceOptions = {}
): ChildProcess {
  const target = resolvedLaunchTarget(instance, appArguments)
  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    [RESOLVED_INSTANCE_ENVIRONMENT]: resolvedInstanceEnvironment(instance)
  }
  delete childEnvironment.ELECTRON_RUN_AS_NODE

  return spawnProcess(
    target.executable,
    target.args,
    {
      detached,
      env: childEnvironment,
      stdio: ipc
        ? ['inherit', 'inherit', 'inherit', 'ipc']
        : 'inherit'
    }
  )
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseStartArguments(args)
  const instance = await resolveStartInstance(parsed)
  await prepareResolvedInstance(instance)
  const child = launchResolvedInstance(instance, parsed.appArguments)
  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal))
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover start: ${message}\n`)
    process.exitCode = 1
  })
}
