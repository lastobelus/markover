import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { discoverRepositoryRoot } from './metadata-discovery'
import { reviewChecksum } from './review-format'

const execFileAsync = promisify(execFile)
const MAXIMUM_PROJECT_DISCOVERIES = 4

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

export type ReviewProjectEvidence = 'verified' | 'conflict' | 'unavailable'
export type ReviewSourceState =
  | 'unchanged'
  | 'changed'
  | 'missing'
  | 'unavailable'

export interface ReviewProjectContext {
  project: ProjectIdentity | null
  projectEvidence: ReviewProjectEvidence
  sourceState: ReviewSourceState
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
    : /^(?:([^@/]+)@)?([^:/]+):(.+)$/.exec(candidate)
  if (scp) {
    host = scp[2] as string
    repositoryPath = scp[3] as string
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
  if (host === 'github.com') {
    repositoryPath = repositoryPath.toLowerCase()
  }
  return `${host}${port ? `:${port}` : ''}/${repositoryPath}`
}

export async function restoreReviewProjectContexts(
  artifacts: ReviewArtifact[],
  discover: (artifact: ReviewArtifact) => Promise<ReviewProjectContext>
): Promise<ReviewProjectContext[]> {
  const contexts: ReviewProjectContext[] = []
  for (
    let index = 0;
    index < artifacts.length;
    index += MAXIMUM_PROJECT_DISCOVERIES
  ) {
    contexts.push(...await Promise.all(
      artifacts.slice(index, index + MAXIMUM_PROJECT_DISCOVERIES).map(discover)
    ))
  }
  return contexts
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

async function sourceState(
  artifact: ReviewArtifact,
  sourcePath: string,
  readSource: (sourcePath: string) => Promise<string>
): Promise<ReviewSourceState> {
  try {
    const currentSource = await readSource(sourcePath)
    return reviewChecksum(currentSource) === artifact.sourceDocument.checksum
      ? 'unchanged'
      : 'changed'
  } catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error
      ? error.code
      : null
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? 'missing'
      : 'unavailable'
  }
}

async function projectIdentity(
  repository: LiveRepositoryProject
): Promise<ProjectIdentity> {
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
}

export async function discoverReviewProjectContext(
  artifact: ReviewArtifact,
  {
    discoverRepository = discoverLiveRepositoryProject,
    readSource = (sourcePath) => fs.readFile(sourcePath, 'utf8')
  }: ReviewProjectContextOptions = {}
): Promise<ReviewProjectContext> {
  if (artifact.review.origin === 'remote-agent') {
    return {
      project: null,
      projectEvidence: 'unavailable',
      sourceState: 'unavailable'
    }
  }
  const snapshotPath = artifact.sourceDocument.path
  if (!snapshotPath) {
    return {
      project: null,
      projectEvidence: 'unavailable',
      sourceState: 'unavailable'
    }
  }
  const sourcePath = path.resolve(snapshotPath)
  const [currentSourceState, repository] = await Promise.all([
    sourceState(artifact, sourcePath, readSource),
    discoverRepository(sourcePath).catch(() => null)
  ])
  if (!repository) {
    return {
      project: null,
      projectEvidence: 'unavailable',
      sourceState: currentSourceState
    }
  }

  const openingRemote = normalizeRepositoryRemote(
    artifact.review.git?.repositoryUrl || null
  )
  const liveRemote = normalizeRepositoryRemote(repository.remoteUrl)
  if (openingRemote && liveRemote && openingRemote !== liveRemote) {
    return {
      project: null,
      projectEvidence: 'conflict',
      sourceState: currentSourceState
    }
  }

  return {
    project: await projectIdentity(repository),
    projectEvidence: 'verified',
    sourceState: currentSourceState
  }
}
