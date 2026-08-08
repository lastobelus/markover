import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

interface ChildResult {
  code: number | null
  pid: number
  stderr: string
  stdout: string
  timedOut: boolean
}

export type SignPackagedApp = (appPath: string) => Promise<void>

function executablePath(appPath: string): string {
  return path.join(appPath, 'Contents', 'MacOS', 'Markover')
}

async function runPackagedApp(
  appPath: string,
  args: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv> = {}
): Promise<ChildResult> {
  return await new Promise<ChildResult>((resolve, reject) => {
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      ...environment,
      MARKOVER_SMOKE_RUNNER: '1'
    }
    if (environment.ELECTRON_RUN_AS_NODE === undefined) {
      delete childEnvironment.ELECTRON_RUN_AS_NODE
    }
    if (environment.NODE_OPTIONS === undefined) {
      delete childEnvironment.NODE_OPTIONS
    }
    const child = spawn(executablePath(appPath), [...args], {
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (!child.pid) {
      reject(new Error('Packaged hardening probe did not receive a process ID.'))
      return
    }
    const pid = child.pid
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    const deadline = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 1000).unref()
    }, 60_000)
    child.on('close', (code) => {
      clearTimeout(deadline)
      void fs.rm(
        path.join(os.tmpdir(), `markover-smoke-${String(pid)}`),
        { recursive: true, force: true }
      ).finally(() => {
        resolve({ code, pid, stderr, stdout, timedOut })
      })
    })
  })
}

export function successfulSmoke(stdout: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(stdout.trim()) as unknown
  } catch {
    return false
  }
  return value !== null &&
    typeof value === 'object' &&
    Reflect.get(value, 'format') === 'markover-smoke' &&
    Reflect.get(value, 'version') === 1 &&
    Reflect.get(value, 'ok') === true
}

function requireSuccessfulSmoke(result: ChildResult, label: string): void {
  if (result.timedOut || result.code !== 0 || !successfulSmoke(result.stdout)) {
    throw new Error(
      `${label} did not complete a normal packaged smoke: ` +
      (result.stderr.trim() || result.stdout.trim() || 'no output')
    )
  }
}

export async function mutateAsarHeader(
  archivePath: string,
  headerString: string
): Promise<void> {
  const match = /"hash":"([a-f0-9])/.exec(headerString)
  if (!match || match.index < 0) {
    throw new Error('app.asar does not contain an integrity hash to tamper.')
  }
  const header = Buffer.from(headerString)
  const archive = await fs.readFile(archivePath)
  const headerOffset = archive.indexOf(header)
  if (headerOffset < 0) {
    throw new Error('app.asar raw header could not be located.')
  }
  const hashCharacterOffset = match.index + '"hash":"'.length
  const replacement = match[1] === 'a' ? 'b' : 'a'
  const handle = await fs.open(archivePath, 'r+')
  try {
    await handle.write(
      Buffer.from(replacement),
      0,
      1,
      headerOffset + hashCharacterOffset
    )
  } finally {
    await handle.close()
  }
}

function copyApp(appPath: string, destination: string): string {
  const copiedApp = path.join(destination, 'Markover.app')
  const result = spawnSync('/usr/bin/ditto', [appPath, copiedApp], {
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `ditto exited ${String(result.status)}`
    )
  }
  return copiedApp
}

function requireRejectedApp(result: ChildResult, label: string): void {
  if (result.timedOut) {
    throw new Error(`${label} timed out instead of being rejected.`)
  }
  if (result.code === 0 || successfulSmoke(result.stdout)) {
    throw new Error(`${label} unexpectedly launched successfully.`)
  }
}

export async function runPackagedHardeningProbes(
  appPath: string,
  signApp: SignPackagedApp
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-hardening-'))
  try {
    const runAsNodeMarker = 'MARKOVER_RUN_AS_NODE_ACTIVE'
    const runAsNode = await runPackagedApp(appPath, [
      '-e',
      `process.stdout.write('${runAsNodeMarker}')`,
      '--',
      '--smoke'
    ], { ELECTRON_RUN_AS_NODE: '1' })
    requireSuccessfulSmoke(runAsNode, 'RunAsNode fuse probe')
    if (runAsNode.stdout.includes(runAsNodeMarker)) {
      throw new Error('ELECTRON_RUN_AS_NODE executed Node.js.')
    }

    const nodeOptionsMarker = path.join(directory, 'node-options-active')
    const nodeOptionsScript = path.join(directory, 'node-options.cjs')
    await fs.writeFile(
      nodeOptionsScript,
      `require('node:fs').writeFileSync(${JSON.stringify(nodeOptionsMarker)}, '')\n`
    )
    const nodeOptions = await runPackagedApp(appPath, ['--smoke'], {
      NODE_OPTIONS: `--require=${nodeOptionsScript}`
    })
    requireSuccessfulSmoke(nodeOptions, 'NODE_OPTIONS fuse probe')
    if (await fs.stat(nodeOptionsMarker).then(() => true, () => false)) {
      throw new Error('NODE_OPTIONS executed privileged startup code.')
    }

    const inspect = await runPackagedApp(appPath, ['--inspect=0', '--smoke'])
    requireSuccessfulSmoke(inspect, 'Node CLI inspection fuse probe')
    if (/Debugger listening|ws:\/\/127\.0\.0\.1/i.test(inspect.stderr)) {
      throw new Error('Node CLI inspection opened a debugger endpoint.')
    }

    const tamperedDirectory = path.join(directory, 'tampered')
    await fs.mkdir(tamperedDirectory)
    const tamperedApp = copyApp(appPath, tamperedDirectory)
    const tamperedAsar = path.join(
      tamperedApp,
      'Contents',
      'Resources',
      'app.asar'
    )
    const { getRawHeader } = await import('@electron/asar')
    await mutateAsarHeader(tamperedAsar, getRawHeader(tamperedAsar).headerString)
    await signApp(tamperedApp)
    requireRejectedApp(
      await runPackagedApp(tamperedApp, ['--noerrdialogs', '--smoke']),
      'ASAR integrity probe'
    )

    const looseDirectory = path.join(directory, 'loose')
    await fs.mkdir(looseDirectory)
    const looseApp = copyApp(appPath, looseDirectory)
    const resources = path.join(looseApp, 'Contents', 'Resources')
    await fs.rm(path.join(resources, 'app.asar'))
    const looseCode = path.join(resources, 'app')
    const looseMarker = path.join(directory, 'loose-code-active')
    await fs.mkdir(looseCode)
    await fs.writeFile(
      path.join(looseCode, 'package.json'),
      `${JSON.stringify({ main: 'index.js' })}\n`
    )
    await fs.writeFile(
      path.join(looseCode, 'index.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(looseMarker)}, '')\n`
    )
    await signApp(looseApp)
    requireRejectedApp(
      await runPackagedApp(looseApp, ['--noerrdialogs', '--smoke']),
      'ASAR-only loading probe'
    )
    if (await fs.stat(looseMarker).then(() => true, () => false)) {
      throw new Error('Electron loaded loose application code outside app.asar.')
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
