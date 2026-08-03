const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const electronPath = require('electron')

const projectDirectory = path.resolve(__dirname, '../..')

async function readStream(stream) {
  stream.setEncoding('utf8')
  let source = ''
  for await (const chunk of stream) source += chunk
  return source
}

function parseReviewArguments(args) {
  let sourcePath = null
  let attachmentsDirectory = path.resolve('.markover', 'attachments')

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
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

async function resolveReviewInput(args, stdin = process.stdin) {
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
      cleanup: async () => {}
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

function launchReview(input) {
  const environment = {
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

async function main() {
  let input
  try {
    input = await resolveReviewInput(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`markover: ${error.message}\n`)
    process.exitCode = 1
    return
  }

  const child = launchReview(input)
  let interrupted = false

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      interrupted = true
      child.kill(signal)
    })
  }

  child.on('error', async (error) => {
    process.stderr.write(`markover: ${error.message}\n`)
    await input.cleanup()
    process.exitCode = 1
  })

  child.on('exit', async (code, signal) => {
    await input.cleanup()
    if (interrupted && signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exitCode = code ?? 1
  })
}

if (require.main === module) main()

module.exports = {
  launchReview,
  parseReviewArguments,
  readStream,
  resolveReviewInput
}
