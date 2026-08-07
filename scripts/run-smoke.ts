#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

interface SmokeResult {
  format: 'markover-smoke'
  version: 1
  ok: boolean
}

interface ChildResult {
  code: number | null
  pid: number
  stderr: string
  stdout: string
  timedOut: boolean
}

const projectDirectory = path.resolve(__dirname, '../..')
const failureDirectory = path.join(projectDirectory, 'tmp/smoke-failures')

function isSmokeResult(value: unknown): value is SmokeResult {
  return value !== null &&
    typeof value === 'object' &&
    Reflect.get(value, 'format') === 'markover-smoke' &&
    Reflect.get(value, 'version') === 1 &&
    typeof Reflect.get(value, 'ok') === 'boolean'
}

function options(args: readonly string[]): {
  appPath: string | null
  timeoutMilliseconds: number
} {
  let appPath: string | null = null
  let timeoutMilliseconds = 10_000
  for (const argument of args) {
    if (argument === '--timeout=10') timeoutMilliseconds = 10_000
    else if (argument === '--timeout=60') timeoutMilliseconds = 60_000
    else if (argument.startsWith('--app=')) {
      if (appPath) throw new Error('--app may be specified only once.')
      appPath = path.resolve(argument.slice('--app='.length))
    } else {
      throw new Error(`Unknown smoke option: ${argument}`)
    }
  }
  return { appPath, timeoutMilliseconds }
}

async function runChild(
  appPath: string | null,
  timeoutMilliseconds: number
): Promise<ChildResult> {
  const loadModule = createRequire(__filename)
  const loadedElectron: unknown = loadModule('electron')
  if (!appPath && typeof loadedElectron !== 'string') {
    throw new Error('Electron executable path is unavailable.')
  }
  const executable = appPath || loadedElectron as string
  const args = appPath
    ? ['--smoke']
    : [path.join(projectDirectory, 'build/app'), '--smoke']
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    MARKOVER_SMOKE_RUNNER: '1'
  }
  delete environment.ELECTRON_RUN_AS_NODE

  return await new Promise<ChildResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: projectDirectory,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (!child.pid) {
      reject(new Error('Smoke process did not receive a process ID.'))
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
    }, timeoutMilliseconds)
    child.on('close', (code) => {
      clearTimeout(deadline)
      resolve({ code, pid, stderr, stdout, timedOut })
    })
  })
}

async function preserveFailure(
  child: ChildResult,
  parsed: unknown
): Promise<void> {
  await fs.rm(failureDirectory, { recursive: true, force: true })
  await fs.mkdir(failureDirectory, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(failureDirectory, 'stdout.log'), child.stdout),
    fs.writeFile(path.join(failureDirectory, 'stderr.log'), child.stderr),
    fs.writeFile(
      path.join(failureDirectory, 'result.json'),
      `${JSON.stringify(parsed, null, 2)}\n`
    ),
    fs.writeFile(
      path.join(failureDirectory, 'timeout.json'),
      `${JSON.stringify({ timedOut: child.timedOut }, null, 2)}\n`
    )
  ])
  const diagnosticPath = path.join(
    os.tmpdir(),
    `markover-smoke-${String(child.pid)}`,
    'startup-diagnostic.json'
  )
  await fs.copyFile(
    diagnosticPath,
    path.join(failureDirectory, 'startup-diagnostic.json')
  ).catch(() => {})
  await fs.copyFile(
    path.join(projectDirectory, 'build/artifacts/app-layout.json'),
    path.join(failureDirectory, 'app-layout.json')
  ).catch(() => {})
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const { appPath, timeoutMilliseconds } = options(args)
  await fs.rm(failureDirectory, { recursive: true, force: true })
  const child = await runChild(appPath, timeoutMilliseconds)
  const output = child.stdout.trim()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(output)
  } catch {
    // The fixed result validation below reports malformed or absent output.
  }
  const passed = !child.timedOut &&
    child.code === 0 &&
    isSmokeResult(parsed) &&
    parsed.ok
  const stateDirectory = path.join(
    os.tmpdir(),
    `markover-smoke-${String(child.pid)}`
  )
  if (!passed) {
    await preserveFailure(child, parsed)
    process.stderr.write(child.stderr)
    process.stderr.write(
      `Smoke failed; evidence saved to ${failureDirectory}\n`
    )
    process.exitCode = 1
  } else {
    process.stdout.write(`${output}\n`)
  }
  await fs.rm(stateDirectory, { recursive: true, force: true })
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`markover smoke: ${message}\n`)
  process.exitCode = 1
})
