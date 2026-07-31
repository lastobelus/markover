const { execFile } = require('node:child_process')
const { createReadStream } = require('node:fs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createInterface } = require('node:readline')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const HANDOFF_KEY_PATTERN = /^mko_handoff_[a-zA-Z0-9]{16,64}$/

async function runGit(args, workingDirectory) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workingDirectory, ...args],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      }
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function discoverGitMetadata(sourcePath, options = {}) {
  const git = options.runGit || runGit
  const workingDirectory = path.dirname(path.resolve(sourcePath))
  const repositoryRoot = await git(
    ['rev-parse', '--show-toplevel'],
    workingDirectory
  )
  if (!repositoryRoot) return null

  const [branch, commit, remoteUrl] = await Promise.all([
    git(['symbolic-ref', '--quiet', '--short', 'HEAD'], workingDirectory),
    git(['rev-parse', '--verify', 'HEAD'], workingDirectory),
    git(['config', '--get', 'remote.origin.url'], workingDirectory)
  ])
  const repositoryUrl = sanitizeRemoteUrl(remoteUrl)
  const metadata = {
    repositoryRoot,
    repositoryUrl,
    branch,
    commit,
    sources: {
      repositoryRoot: 'git-cli',
      ...(repositoryUrl ? { repositoryUrl: 'git-cli' } : {}),
      ...(branch ? { branch: 'git-cli' } : {}),
      ...(commit ? { commit: 'git-cli' } : {})
    }
  }
  return metadata
}

function sanitizeRemoteUrl(remoteUrl) {
  if (!remoteUrl?.includes('://')) return remoteUrl || null
  try {
    const parsed = new URL(remoteUrl)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

async function sessionLogPaths(directory) {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sessionLogPaths(entryPath)
    return entry.isFile() && entry.name.endsWith('.jsonl')
      ? [entryPath]
      : []
  }))
  return nested.flat()
}

function containsHandoffKey(contents, key) {
  let index = contents.indexOf(key)
  while (index !== -1) {
    const before = contents[index - 1] || ''
    const after = contents[index + key.length] || ''
    if (
      !/[a-zA-Z0-9_]/.test(before) &&
      !/[a-zA-Z0-9_]/.test(after)
    ) {
      return true
    }
    index = contents.indexOf(key, index + key.length)
  }
  return false
}

async function readTail(logPath, size, maximumBytes) {
  const bytesToRead = Math.min(size, maximumBytes)
  const buffer = Buffer.alloc(bytesToRead)
  const handle = await fs.open(logPath, 'r')
  try {
    await handle.read(buffer, 0, bytesToRead, size - bytesToRead)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readSessionMetadata(logPath) {
  const input = createReadStream(logPath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line)
        if (record.type === 'session_meta' && record.payload) {
          return record.payload
        }
      } catch {}
      return null
    }
    return null
  } finally {
    lines.close()
    input.destroy()
  }
}

function sessionMetadata(contents) {
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (record.type === 'session_meta' && record.payload) {
        return record.payload
      }
    } catch {}
  }
  return null
}

async function discoverCodexThread(handoffKey, options = {}) {
  const key = handoffKey?.trim()
  if (!HANDOFF_KEY_PATTERN.test(key || '')) return null
  const directory = options.sessionsDirectory || path.join(
    os.homedir(),
    '.codex',
    'sessions'
  )
  const paths = await sessionLogPaths(directory)
  const logs = (await Promise.all(paths.map(async (logPath) => {
    try {
      const stats = await fs.stat(logPath)
      return {
        logPath,
        modifiedAt: stats.mtimeMs,
        size: stats.size
      }
    } catch {
      return null
    }
  }))).filter(Boolean)
  logs.sort((left, right) => right.modifiedAt - left.modifiedAt)

  const maximumLogs = options.maximumLogs ?? 50
  const tailBytes = options.tailBytes ?? 512 * 1024
  let remainingBytes = options.maximumBytes ?? 16 * 1024 * 1024
  const matches = []
  for (const log of logs.slice(0, maximumLogs)) {
    const bytesToRead = Math.min(log.size, tailBytes, remainingBytes)
    if (bytesToRead <= 0) break
    remainingBytes -= bytesToRead
    let contents
    try {
      contents = await readTail(log.logPath, log.size, bytesToRead)
    } catch {
      continue
    }
    if (!containsHandoffKey(contents, key)) continue
    let metadata
    try {
      metadata = await readSessionMetadata(log.logPath)
    } catch {
      continue
    }
    const sessionId = metadata?.id || metadata?.session_id
    if (!sessionId) continue
    matches.push({
      provider: 'codex',
      id: sessionId,
      discovery: 'handoff-key',
      cwd: metadata.cwd || null,
      logPath: log.logPath,
      parentThreadId: metadata.parent_thread_id || null,
      forkedFromId: metadata.forked_from_id || null
    })
  }

  const expectedPath = options.expectedPath
    ? path.resolve(options.expectedPath)
    : null
  const matchingWorkspace = expectedPath
    ? matches.filter((match) => {
        if (!match.cwd) return false
        const relative = path.relative(path.resolve(match.cwd), expectedPath)
        return relative === '' || (
          !relative.startsWith('..') &&
          !path.isAbsolute(relative)
        )
      })
    : []
  const candidates = matchingWorkspace.length ? matchingWorkspace : matches
  return candidates.length === 1 ? candidates[0] : null
}

async function discoverReviewMetadata({
  sourcePath,
  branch = null,
  pullRequestNumber = null,
  threadId = null,
  handoffKey = null
}, options = {}) {
  const discoveredGit = await discoverGitMetadata(
    sourcePath,
    options.git
  ).catch(() => null)
  const git = discoveredGit || (branch ? { sources: {} } : null)
  if (branch) {
    git.branch = branch
    git.sources.branch = 'explicit'
  }

  let agentThread = threadId
    ? {
        provider: 'codex',
        id: threadId,
        discovery: 'explicit'
      }
    : null
  if (!agentThread && handoffKey) {
    agentThread = await discoverCodexThread(
      handoffKey,
      {
        ...options.codex,
        expectedPath: sourcePath
      }
    ).catch(() => null)
  }

  return {
    git,
    agentThread,
    pullRequest: pullRequestNumber
      ? {
          number: pullRequestNumber,
          discovery: 'explicit'
        }
      : null
  }
}

module.exports = {
  containsHandoffKey,
  discoverCodexThread,
  discoverGitMetadata,
  discoverReviewMetadata,
  HANDOFF_KEY_PATTERN,
  sanitizeRemoteUrl,
  sessionMetadata
}
