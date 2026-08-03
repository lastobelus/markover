import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'

const loadModule = createRequire(__filename)
const loadedElectron: unknown = loadModule('electron')
if (typeof loadedElectron !== 'string') {
  throw new Error('Electron executable path is unavailable.')
}
const electronPath = loadedElectron

const projectDirectory = path.resolve(__dirname, '../..')

export interface ReviewArguments {
  attachmentsDirectory: string
  sourcePath: string | null
}

export interface ReviewInput {
  attachmentsDirectory: string
  inputPath: string
  name: string
  originalPath: string | null
  cleanup: () => Promise<void>
}

export async function readStream(stream: Readable): Promise<string> {
  stream.setEncoding('utf8')
  let source = ''
  for await (const chunk of stream) source += String(chunk)
  return source
}

export function parseReviewArguments(args: string[]): ReviewArguments {
  let sourcePath = null
  let attachmentsDirectory = path.resolve('.markover', 'attachments')

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) break
    if (argument === '--attachments-dir') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--attachments-dir requires a path.')
      }
      attachmentsDirectory = path.resolve(value)
      index += 1
      continue
    }

    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`)
    }
    if (sourcePath) {
      throw new Error('Expected a Markdown path or piped Markdown, not both.')
    }
    sourcePath = argument
  }

  return { attachmentsDirectory, sourcePath }
}

export async function resolveReviewInput(
  args: string[],
  stdin: Readable = process.stdin
): Promise<ReviewInput> {
  const { attachmentsDirectory, sourcePath } = parseReviewArguments(args)

  if (sourcePath) {
    const filePath = path.resolve(sourcePath)
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) throw new Error(`Not a file: ${filePath}`)
    return {
      attachmentsDirectory,
      inputPath: filePath,
      name: path.basename(filePath),
      originalPath: filePath,
      cleanup: () => Promise.resolve()
    }
  }

  const source = await readStream(stdin)
  if (source.length === 0) {
    throw new Error('Pass a Markdown path or pipe Markdown to stdin.')
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-'))
  const inputPath = path.join(temporaryDirectory, 'stdin.md')
  await fs.writeFile(inputPath, source, 'utf8')

  return {
    attachmentsDirectory,
    inputPath,
    name: 'stdin.md',
    originalPath: null,
    cleanup: () => fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export function launchReview(input: ReviewInput): ChildProcess {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    MARKOVER_REVIEW_INPUT_PATH: input.inputPath,
    MARKOVER_REVIEW_NAME: input.name,
    MARKOVER_REVIEW_ORIGINAL_PATH: input.originalPath || '',
    MARKOVER_ATTACHMENTS_DIR: input.attachmentsDirectory
  }
  delete environment.ELECTRON_RUN_AS_NODE

  return spawn(electronPath, [projectDirectory, '--markover-review'], {
    env: environment,
    stdio: ['ignore', 'inherit', 'inherit']
  })
}

async function main(): Promise<void> {
  let input: ReviewInput
  try {
    input = await resolveReviewInput(process.argv.slice(2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover: ${message}\n`)
    process.exitCode = 1
    return
  }

  const child = launchReview(input)
  let interrupted = false

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      interrupted = true
      child.kill(signal)
    })
  }

  child.on('error', (error) => {
    void (async () => {
      process.stderr.write(`markover: ${error.message}\n`)
      await input.cleanup()
      process.exitCode = 1
    })()
  })

  child.on('exit', (code, signal) => {
    void (async () => {
      await input.cleanup()
      if (interrupted && signal) {
        process.kill(process.pid, signal)
        return
      }
      process.exitCode = code ?? 1
    })()
  })
}

if (require.main === module) void main()
