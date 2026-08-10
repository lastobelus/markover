import { spawn, type ChildProcess } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

import { DEVELOPMENT_CONTROL_QUIT } from '../src/development-control'
import {
  probeService,
  readEndpoint,
  requestServiceQuit
} from '../src/local-client'
import type { ResolvedInstance } from '../src/instance'
import {
  launchResolvedInstance,
  parseStartArguments,
  resolveStartInstance,
  type ParsedStartArguments
} from './start'

const projectDirectory = path.resolve(__dirname, '../..')
const DEFAULT_DEBOUNCE_MILLISECONDS = 120
const DEFAULT_TRANSITION_TIMEOUT_MILLISECONDS = 30_000
const DEFAULT_POLL_MILLISECONDS = 100

const watchedDirectories = [
  '.github',
  'design/brand',
  'docs',
  'examples',
  'packages/cli/src',
  'scripts',
  'src',
  'test'
] as const

const watchedFiles = new Set([
  '.markover/development.json',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'favicon.svg',
  'package.json',
  'packages/cli/package.json',
  'tsconfig.build.json',
  'tsconfig.json'
])

export interface DevelopmentProcess {
  exitCode: number | null
  once?: ((
    event: 'error',
    listener: (error: Error) => void
  ) => unknown) | undefined
  pid?: number | undefined
  send?: ChildProcess['send'] | undefined
  signalCode: NodeJS.Signals | null
}

export interface DevelopmentWatchOperations {
  build: () => Promise<void>
  reportError?: ((error: unknown) => void) | undefined
  restart: () => Promise<void>
}

export interface DevelopmentWatchControllerOptions {
  debounceMilliseconds?: number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

function normalizedRelativePath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/').replace(/^\.\//, '')
}

export function isDevelopmentBuildInput(filePath: string | null): boolean {
  if (filePath === null) return true
  const relativePath = normalizedRelativePath(filePath)
  if (watchedFiles.has(relativePath)) return true
  return watchedDirectories.some((directory) => (
    relativePath === directory || relativePath.startsWith(`${directory}/`)
  ))
}

export class DevelopmentWatchController {
  private readonly build: () => Promise<void>
  private readonly clearTimer: typeof clearTimeout
  private readonly debounceMilliseconds: number
  private readonly reportError: (error: unknown) => void
  private readonly restart: () => Promise<void>
  private readonly setTimer: typeof setTimeout
  private closed = false
  private completedRevision = 0
  private revision = 0
  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly idleWaiters = new Set<() => void>()

  constructor(
    { build, reportError = () => {}, restart }: DevelopmentWatchOperations,
    {
      debounceMilliseconds = DEFAULT_DEBOUNCE_MILLISECONDS,
      setTimer = globalThis.setTimeout,
      clearTimer = globalThis.clearTimeout
    }: DevelopmentWatchControllerOptions = {}
  ) {
    this.build = build
    this.clearTimer = clearTimer
    this.debounceMilliseconds = debounceMilliseconds
    this.reportError = reportError
    this.restart = restart
    this.setTimer = setTimer
  }

  notify(filePath: string | null): boolean {
    if (this.closed || !isDevelopmentBuildInput(filePath)) return false
    this.revision += 1
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = this.setTimer(() => {
      this.timer = null
      this.startCycle()
    }, this.debounceMilliseconds)
    return true
  }

  close(): void {
    this.closed = true
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    this.resolveIdleWaiters()
  }

  waitForIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.add(resolve))
  }

  private isIdle(): boolean {
    return this.timer === null && this.running === null && (
      this.closed || this.completedRevision >= this.revision
    )
  }

  private resolveIdleWaiters(): void {
    if (!this.isIdle()) return
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }

  private startCycle(): void {
    if (this.closed || this.running !== null) return
    const targetRevision = this.revision
    this.running = (async () => {
      try {
        await this.build()
        await this.restart()
      } catch (error) {
        this.reportError(error)
      } finally {
        this.completedRevision = targetRevision
      }
    })().finally(() => {
      this.running = null
      if (
        !this.closed &&
        this.timer === null &&
        this.completedRevision < this.revision
      ) this.startCycle()
      this.resolveIdleWaiters()
    })
  }
}

interface WatchTarget {
  checkout: string
  endpointPath: string
  identityKey: string
  selector: NonNullable<ParsedStartArguments['selector']>
}

export interface DevelopmentInstanceManagerOptions {
  checkoutDirectory?: string | undefined
  isProcessAlive?: ((pid: number) => boolean) | undefined
  launch?: ((
    instance: ResolvedInstance,
    appArguments: readonly string[]
  ) => DevelopmentProcess) | undefined
  now?: (() => number) | undefined
  pollMilliseconds?: number | undefined
  probe?: ((endpointPath: string) => Promise<unknown>) | undefined
  quit?: ((endpointPath: string) => Promise<void>) | undefined
  readProcessEndpoint?: ((endpointPath: string) => Promise<{ pid: number }>) | undefined
  resolve?: (() => Promise<ResolvedInstance>) | undefined
  timeoutMilliseconds?: number | undefined
  wait?: ((milliseconds: number) => Promise<void>) | undefined
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code: unknown = error !== null && typeof error === 'object'
      ? Reflect.get(error, 'code')
      : null
    return code !== 'ESRCH'
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function targetFromInstance(
  instance: ResolvedInstance,
  checkoutDirectory: string
): WatchTarget {
  if (!instance.checkout) {
    throw new Error(
      `Cannot watch ${instance.identity.key}: its checkout is unavailable.`
    )
  }
  const checkout = path.resolve(instance.checkout)
  if (checkout !== path.resolve(checkoutDirectory)) {
    throw new Error(
      `Cannot watch ${instance.identity.key}: run the loop from its owning checkout ${checkout}.`
    )
  }
  return {
    checkout,
    endpointPath: instance.service.endpointPath,
    identityKey: instance.identity.key,
    selector: instance.identity.kind === 'canonical'
      ? 'canonical'
      : 'development'
  }
}

function assertExactTarget(
  target: WatchTarget,
  instance: ResolvedInstance
): void {
  if (
    instance.identity.key !== target.identityKey ||
    !instance.checkout ||
    path.resolve(instance.checkout) !== target.checkout
  ) {
    throw new Error(
      `Resolved ${instance.identity.key} does not match watched ${target.identityKey}.`
    )
  }
}

export class DevelopmentInstanceManager {
  private activeProcess: DevelopmentProcess | null = null
  private readonly appArguments: readonly string[]
  private readonly isProcessAlive: (pid: number) => boolean
  private readonly launch: (
    instance: ResolvedInstance,
    appArguments: readonly string[]
  ) => DevelopmentProcess
  private readonly now: () => number
  private readonly pollMilliseconds: number
  private readonly probe: (endpointPath: string) => Promise<unknown>
  private readonly quit: (endpointPath: string) => Promise<void>
  private readonly readProcessEndpoint: (
    endpointPath: string
  ) => Promise<{ pid: number }>
  private readonly resolve: () => Promise<ResolvedInstance>
  private readonly target: WatchTarget
  private readonly timeoutMilliseconds: number
  private readonly wait: (milliseconds: number) => Promise<void>

  constructor(
    initialInstance: ResolvedInstance,
    appArguments: readonly string[],
    {
      checkoutDirectory = projectDirectory,
      isProcessAlive = processIsAlive,
      launch = (instance, appArguments) => launchResolvedInstance(
        instance,
        appArguments,
        { detached: process.platform !== 'win32', ipc: true }
      ),
      now = Date.now,
      pollMilliseconds = DEFAULT_POLL_MILLISECONDS,
      probe = probeService,
      quit = requestServiceQuit,
      readProcessEndpoint = readEndpoint,
      resolve,
      timeoutMilliseconds = DEFAULT_TRANSITION_TIMEOUT_MILLISECONDS,
      wait = delay
    }: DevelopmentInstanceManagerOptions = {}
  ) {
    this.target = targetFromInstance(initialInstance, checkoutDirectory)
    this.appArguments = appArguments
    this.isProcessAlive = isProcessAlive
    this.launch = launch
    this.now = now
    this.pollMilliseconds = pollMilliseconds
    this.probe = probe
    this.quit = quit
    this.readProcessEndpoint = readProcessEndpoint
    this.resolve = resolve || (() => resolveStartInstance({
      selector: this.target.selector,
      appArguments: [...this.appArguments]
    }))
    this.timeoutMilliseconds = timeoutMilliseconds
    this.wait = wait
  }

  get identityKey(): string {
    return this.target.identityKey
  }

  async restart(): Promise<void> {
    await this.stopActiveProcess()
    const current = await this.resolveExactInstance()
    const endpointPid = current.process.status === 'running'
      ? (await this.readProcessEndpoint(current.service.endpointPath)).pid
      : null

    if (endpointPid !== null) {
      this.assertRestartEligible(current)
      await this.stopRunningProcess(endpointPid, endpointPid)
    }

    const stopped = await this.resolveExactInstance()
    if (
      stopped.process.status !== 'stopped' ||
      !stopped.coldStart.eligible
    ) {
      throw new Error(
        `Cannot restart ${this.identityKey}: ${stopped.coldStart.blockedBy || 'not stopped'}.`
      )
    }

    const launched = this.launch(stopped, this.appArguments)
    const launchFailure = launched.once
      ? new Promise<never>((_resolve, reject) => {
          launched.once?.('error', (error) => {
            reject(new Error(
              `Cannot launch ${this.identityKey}: ${errorMessage(error)}`
            ))
          })
        })
      : null
    if (!launched.pid) {
      if (launchFailure !== null) await launchFailure
      throw new Error(`Cannot restart ${this.identityKey}: Electron did not report a process ID.`)
    }
    this.activeProcess = launched
    const readiness = this.waitForReady(stopped.service.endpointPath, launched)
    await (launchFailure === null
      ? readiness
      : Promise.race([readiness, launchFailure]))
  }

  async stop(): Promise<void> {
    if (await this.stopActiveProcess()) return
    const current = await this.resolveExactInstance()
    const endpointPid = current.process.status === 'running'
      ? (await this.readProcessEndpoint(current.service.endpointPath)).pid
      : null
    if (endpointPid === null) return

    await this.stopRunningProcess(endpointPid, endpointPid)
  }

  private assertRestartEligible(instance: ResolvedInstance): void {
    if (
      instance.identity.kind === 'development' &&
      instance.pullRequest?.state !== 'open'
    ) {
      throw new Error(
        `Cannot restart ${instance.identity.key}: its pull request is ${instance.pullRequest?.state || 'unavailable'}.`
      )
    }
  }

  private async stopRunningProcess(
    runningPid: number,
    endpointPid: number | null
  ): Promise<void> {
    if (endpointPid !== null) {
      await this.quit(this.target.endpointPath)
    } else {
      const active = this.activeProcess
      if (active?.pid !== runningPid || !active.send) {
        throw new Error(
          `Cannot stop ${this.identityKey}: its owned process has no control channel.`
        )
      }
      active.send(DEVELOPMENT_CONTROL_QUIT)
    }
    await this.waitForStop(runningPid)
    this.activeProcess = null
  }

  private async stopActiveProcess(): Promise<boolean> {
    const activePid = this.liveActiveProcessPid()
    if (activePid === null) return false
    let endpointPid: number | null = null
    try {
      await this.probe(this.target.endpointPath)
      const endpoint = await this.readProcessEndpoint(this.target.endpointPath)
      if (endpoint.pid === activePid) endpointPid = activePid
    } catch {
      // A watcher-owned pre-service process still has its private control path.
    }
    await this.stopRunningProcess(activePid, endpointPid)
    return true
  }

  private liveActiveProcessPid(): number | null {
    const active = this.activeProcess
    if (
      !active?.pid ||
      active.exitCode !== null ||
      active.signalCode !== null ||
      !this.isProcessAlive(active.pid)
    ) {
      this.activeProcess = null
      return null
    }
    return active.pid
  }

  private async resolveExactInstance(): Promise<ResolvedInstance> {
    const instance = await this.resolve()
    assertExactTarget(this.target, instance)
    return instance
  }

  private async waitForStop(pid: number): Promise<void> {
    const deadline = this.now() + this.timeoutMilliseconds
    while (this.now() < deadline) {
      if (!this.isProcessAlive(pid)) return
      await this.wait(this.pollMilliseconds)
    }
    throw new Error(
      `Timed out waiting for ${this.identityKey} to finish its shutdown.`
    )
  }

  private async waitForReady(
    endpointPath: string,
    launched: DevelopmentProcess
  ): Promise<void> {
    const deadline = this.now() + this.timeoutMilliseconds
    let lastError: unknown = null
    while (this.now() < deadline) {
      if (launched.exitCode !== null || launched.signalCode !== null) {
        throw new Error(
          `${this.identityKey} exited before becoming ready.`
        )
      }
      try {
        await this.probe(endpointPath)
        return
      } catch (error) {
        lastError = error
      }
      await this.wait(this.pollMilliseconds)
    }
    throw new Error(
      `Timed out waiting for ${this.identityKey} readiness: ${errorMessage(lastError)}`
    )
  }
}

function runBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build', '--silent'], {
      cwd: projectDirectory,
      env: process.env,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(
        `Build failed${signal ? ` with ${signal}` : ` with exit ${String(code)}`}.`
      ))
    })
  })
}

function watchedPath(filename: string | Buffer | null): string | null {
  if (filename === null) return null
  return Buffer.isBuffer(filename) ? filename.toString('utf8') : filename
}

function startFilesystemWatcher(
  controller: DevelopmentWatchController
): FSWatcher {
  const watcher = watch(projectDirectory, { recursive: true }, (
    _event,
    filename
  ) => {
    controller.notify(watchedPath(filename))
  })
  watcher.on('error', (error) => {
    process.stderr.write(`markover dev watcher: ${errorMessage(error)}\n`)
  })
  return watcher
}

export interface DevelopmentLoop {
  notify: (filePath: string | null) => boolean
  stop: (signal: NodeJS.Signals) => Promise<void>
}

export interface DevelopmentLoopOptions {
  externalWatch?: boolean
}

export async function main(
  args = process.argv.slice(2),
  { externalWatch = false }: DevelopmentLoopOptions = {}
): Promise<DevelopmentLoop> {
  const parsed = parseStartArguments(args)
  const initialInstance = await resolveStartInstance(parsed)
  const manager = new DevelopmentInstanceManager(
    initialInstance,
    parsed.appArguments
  )
  const controller = new DevelopmentWatchController({
    async build() {
      process.stderr.write(
        `markover dev ${manager.identityKey}: rebuilding.\n`
      )
      await runBuild()
    },
    async restart() {
      await manager.restart()
      process.stderr.write(
        `markover dev ${manager.identityKey}: ready.\n`
      )
    },
    reportError(error) {
      process.stderr.write(
        `markover dev ${manager.identityKey}: ${errorMessage(error)} Keeping the watcher active.\n`
      )
    }
  })
  const filesystemWatcher = externalWatch
    ? null
    : startFilesystemWatcher(controller)
  process.stderr.write(
    `markover dev: watching ${manager.identityKey}; awaiting a successful rebuild.\n`
  )
  controller.notify(null)

  let stopping = false
  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return
    stopping = true
    filesystemWatcher?.close()
    controller.close()
    process.stderr.write(
      `markover dev ${manager.identityKey}: ${signal}; waiting for managed shutdown.\n`
    )
    try {
      await controller.waitForIdle()
      await manager.stop()
    } catch (error) {
      process.stderr.write(
        `markover dev ${manager.identityKey}: shutdown failed: ${errorMessage(error)}\n`
      )
      process.exitCode = 1
    }
  }
  return {
    notify(filePath) {
      return controller.notify(filePath)
    },
    stop
  }
}

if (require.main === module) {
  void main().then((loop) => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => { void loop.stop(signal) })
    }
  }).catch((error: unknown) => {
    process.stderr.write(`markover dev: ${errorMessage(error)}\n`)
    process.exitCode = 1
  })
}
