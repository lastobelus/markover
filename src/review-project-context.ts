import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { discoverRepositoryRoot } from './metadata-discovery'
import { reviewChecksum } from './review-format'

const execFileAsync = promisify(execFile)

interface LiveRepositoryProject {
  root: string
  remoteUrl: string | null
  commonGitDirectory: string | null
}

interface ReviewProjectContextOptions {
  discoverRepository?: (
    sourcePath: string
  ) => Promise<LiveRepositoryProject | null>
  readSource?: (sourcePath: string) => Promise<string>
}

async function gitValue(
  workingDirectory: string,
  args: string[]
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workingDirectory, ...args],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 }
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function canonicalPath(value: string): Promise<string> {
  try {
    return await fs.realpath(value)
  } catch {
    return path.resolve(value)
  }
}

async function discoverLiveRepositoryProject(
  sourcePath: string
): Promise<LiveRepositoryProject | null> {
  const root = await discoverRepositoryRoot(sourcePath)
  if (!root) return null
  const canonicalRoot = await canonicalPath(root)
  const [remoteUrl, commonDirectory] = await Promise.all([
    gitValue(canonicalRoot, ['remote', 'get-url', 'origin']),
    gitValue(canonicalRoot, ['rev-parse', '--git-common-dir'])
  ])
  const commonGitDirectory = commonDirectory
    ? await canonicalPath(path.resolve(canonicalRoot, commonDirectory))
    : null
  return { root: canonicalRoot, remoteUrl, commonGitDirectory }
}

export function normalizeRepositoryRemote(value: string | null): string | null {
  const candidate = value?.trim()
  if (!candidate || candidate.startsWith('file:')) return null

  let host: string
  let port = ''
  let repositoryPath: string
  const scp = candidate.includes('://')
    ? null
    : /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(candidate)
  if (scp) {
    host = scp[1] as string
    repositoryPath = scp[2] as string
  } else {
    let remote: URL
    try {
      remote = new URL(candidate)
    } catch {
      return null
    }
    if (!remote.hostname) return null
    host = remote.hostname
    port = remote.port
    repositoryPath = remote.pathname
  }

  host = host.toLowerCase()
  repositoryPath = repositoryPath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
  if (!repositoryPath) return null
  if (host === 'github.com') repositoryPath = repositoryPath.toLowerCase()
  return `${host}${port ? `:${port}` : ''}/${repositoryPath}`
}

function repositoryName(key: string): string {
  const name = key.split('/').pop() || ''
  try {
    return decodeURIComponent(name) || 'Other'
  } catch {
    return name || 'Other'
  }
}

function commonRepositoryName(commonGitDirectory: string): string {
  const base = path.basename(commonGitDirectory)
  const candidate = base === '.git'
    ? path.basename(path.dirname(commonGitDirectory))
    : base.replace(/\.git$/i, '')
  return candidate || 'Other'
}

export async function discoverVerifiedReviewProjectContext(
  artifact: ReviewArtifact,
  {
    discoverRepository = discoverLiveRepositoryProject,
    readSource = (sourcePath) => fs.readFile(sourcePath, 'utf8')
  }: ReviewProjectContextOptions = {}
): Promise<ProjectIdentity | null> {
  const snapshotPath = artifact.sourceDocument.path
  if (!snapshotPath) return null
  const sourcePath = path.resolve(snapshotPath)
  try {
    const currentSource = await readSource(sourcePath)
    if (reviewChecksum(currentSource) !== artifact.sourceDocument.checksum) {
      return null
    }
    const repository = await discoverRepository(sourcePath)
    if (!repository) return null
    const root = await canonicalPath(repository.root)
    const remote = normalizeRepositoryRemote(repository.remoteUrl)
    if (remote) {
      return {
        key: `remote:${remote}`,
        name: repositoryName(remote),
        root
      }
    }
    if (repository.commonGitDirectory) {
      const commonGitDirectory = await canonicalPath(
        repository.commonGitDirectory
      )
      return {
        key: `git:${commonGitDirectory}`,
        name: commonRepositoryName(commonGitDirectory),
        root
      }
    }
    return {
      key: `root:${root}`,
      name: path.basename(root) || 'Other',
      root
    }
  } catch {
    return null
  }
}
