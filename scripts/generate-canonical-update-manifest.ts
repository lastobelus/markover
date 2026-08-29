import fs from 'node:fs/promises'
import path from 'node:path'

import {
  decodeCanonicalUpdateManifest,
  type CanonicalUpdateManifest,
  type CanonicalUpdatePullRequest
} from '../src/canonical-update-manifest'

const API_URL = 'https://api.github.com/graphql'
const API_VERSION = '2022-11-28'
const EXPECTED_REPOSITORY = 'lastobelus/markover'
const MAXIMUM_API_RESPONSE_BYTES = 512 * 1024
const API_TIMEOUT_MILLISECONDS = 15_000
const MAXIMUM_PULL_REQUESTS = 100
const MAXIMUM_ASSOCIATED_PULL_REQUESTS = 5
const OUTPUT_PATH = 'build/docs/user/update-manifest.json'
const SHA_PATTERN = /^[a-f0-9]{40}$/

const QUERY = `query CanonicalUpdateManifest(
  $owner: String!
  $name: String!
  $limit: Int!
  $associatedLimit: Int!
) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          oid
          history(first: $limit) {
            nodes {
              oid
              associatedPullRequests(first: $associatedLimit) {
                nodes {
                  baseRefName
                  mergeCommit { oid }
                  mergedAt
                  number
                  state
                  title
                }
              }
            }
          }
        }
      }
    }
  }
}`

interface GenerateOptions {
  expectedHead: string
  fetchImplementation?: typeof fetch
  generatedAt?: string
  repository?: string
  token: string
}

interface GitHubPullRequest {
  baseRefName?: unknown
  mergeCommit?: {
    oid?: unknown
  } | null
  mergedAt?: unknown
  number?: unknown
  state?: unknown
  title?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    throw new Error(`${label} is not a full lowercase Git commit.`)
  }
  return value
}

function requireTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} is not an ISO timestamp.`)
  }
  return value
}

function requirePullRequest(value: unknown): CanonicalUpdatePullRequest {
  if (!isRecord(value)) throw new Error('GitHub returned an invalid pull request.')
  const record = value as GitHubPullRequest
  const number = record.number
  const rawTitle = record.title
  if (
    !Number.isSafeInteger(number) ||
    Number(number) < 1 ||
    typeof rawTitle !== 'string' ||
    record.baseRefName !== 'main' ||
    record.state !== 'MERGED'
  ) {
    throw new Error('GitHub returned an invalid pull request.')
  }
  let normalizedTitle = ''
  for (const character of rawTitle) {
    const codePoint = character.codePointAt(0) ?? 0
    normalizedTitle += codePoint <= 0x1f || codePoint === 0x7f
      ? ' '
      : character
  }
  const title = normalizedTitle
    .trim()
    .slice(0, 200)
    .trim()
  if (title.length === 0) throw new Error('GitHub returned an empty pull request title.')
  return {
    number: Number(number),
    title,
    mergeCommit: requireSha(record.mergeCommit?.oid, 'Pull request merge commit'),
    mergedAt: requireTimestamp(record.mergedAt, 'Pull request merge time')
  }
}

function pullRequestForCommit(value: unknown): CanonicalUpdatePullRequest | null {
  if (!isRecord(value)) throw new Error('GitHub returned an invalid commit history.')
  const commit = requireSha(value.oid, 'History commit')
  const connection = value.associatedPullRequests
  const nodes = isRecord(connection) ? connection.nodes : null
  if (!Array.isArray(nodes) || nodes.length > MAXIMUM_ASSOCIATED_PULL_REQUESTS) {
    throw new Error('GitHub returned an invalid associated pull request collection.')
  }
  const matches = nodes.flatMap((node) => {
    if (!isRecord(node)) {
      throw new Error('GitHub returned an invalid associated pull request.')
    }
    const mergeCommit = node.mergeCommit
    if (
      node.baseRefName !== 'main' ||
      node.state !== 'MERGED' ||
      !isRecord(mergeCommit) ||
      mergeCommit.oid !== commit
    ) return []
    return [requirePullRequest(node)]
  })
  if (matches.length > 1) {
    throw new Error('GitHub returned ambiguous pull requests for a main commit.')
  }
  return matches[0] ?? null
}

async function boundedJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`)
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new Error('GitHub did not return JSON.')
  }
  const contentLength = response.headers.get('content-length')
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAXIMUM_API_RESPONSE_BYTES)
  ) {
    throw new Error('GitHub returned an oversized response.')
  }
  if (!response.body) throw new Error('GitHub returned an empty response.')
  const chunks: Uint8Array[] = []
  const reader = response.body.getReader()
  let length = 0
  try {
    let result = await reader.read()
    while (!result.done) {
      length += result.value.byteLength
      if (length > MAXIMUM_API_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('GitHub returned an oversized response.')
      }
      chunks.push(result.value)
      result = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
  } catch {
    throw new Error('GitHub returned invalid JSON.')
  }
}

export async function generateCanonicalUpdateManifest({
  expectedHead,
  fetchImplementation = fetch,
  generatedAt = new Date().toISOString(),
  repository = EXPECTED_REPOSITORY,
  token
}: GenerateOptions): Promise<CanonicalUpdateManifest> {
  if (repository !== EXPECTED_REPOSITORY) {
    throw new Error(`Refusing to generate a manifest for ${repository}.`)
  }
  const headCommit = requireSha(expectedHead, 'Expected main head')
  requireTimestamp(generatedAt, 'Manifest generation time')
  if (token.trim().length === 0) throw new Error('GITHUB_TOKEN is required.')

  const [owner, name] = repository.split('/') as [string, string]
  const response = await fetchImplementation(API_URL, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(API_TIMEOUT_MILLISECONDS),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'markover-update-manifest',
      'x-github-api-version': API_VERSION
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        owner,
        name,
        limit: MAXIMUM_PULL_REQUESTS,
        associatedLimit: MAXIMUM_ASSOCIATED_PULL_REQUESTS
      }
    })
  })
  const payload = await boundedJsonResponse(response)
  if (!isRecord(payload)) throw new Error('GitHub returned an invalid response.')
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error('GitHub could not generate the update manifest.')
  }
  const data = payload.data
  const githubRepository = isRecord(data) ? data.repository : null
  const defaultBranchRef = isRecord(githubRepository)
    ? githubRepository.defaultBranchRef
    : null
  const target = isRecord(defaultBranchRef) ? defaultBranchRef.target : null
  const liveHead = requireSha(
    isRecord(target) ? target.oid : null,
    'GitHub default branch head'
  )
  if (liveHead !== headCommit) {
    throw new Error('The checked-out main head is no longer GitHub’s default branch head.')
  }
  const history = isRecord(target) ? target.history : null
  const nodes = isRecord(history) ? history.nodes : null
  if (
    !Array.isArray(nodes) ||
    nodes.length < 1 ||
    nodes.length > MAXIMUM_PULL_REQUESTS
  ) {
    throw new Error('GitHub returned an invalid commit history.')
  }
  const historyCommits = nodes.map((node) => {
    if (!isRecord(node)) throw new Error('GitHub returned an invalid commit history.')
    return requireSha(node.oid, 'History commit')
  })
  if (historyCommits[0] !== headCommit) {
    throw new Error('GitHub returned a commit history for the wrong main head.')
  }
  const baseCommit = historyCommits.at(-1)
  if (!baseCommit) throw new Error('GitHub returned an empty commit history.')
  const pullRequests = nodes
    .slice(0, -1)
    .map(pullRequestForCommit)
    .filter((pullRequest): pullRequest is CanonicalUpdatePullRequest => {
      return pullRequest !== null
    })
    .reverse()
  const headIsPullRequest = pullRequests.at(-1)?.mergeCommit === headCommit

  // A direct main push cannot be represented as a PR-derived chain in v1. Reset
  // the bounded display history at that exact head; update authorization never
  // trusts this display-only artifact.
  let manifest: CanonicalUpdateManifest
  if (!headIsPullRequest) {
    manifest = {
      version: 1,
      repository: EXPECTED_REPOSITORY,
      generatedAt,
      baseCommit: headCommit,
      headCommit,
      pullRequests: []
    }
  } else {
    manifest = {
      version: 1,
      repository: EXPECTED_REPOSITORY,
      generatedAt,
      baseCommit,
      headCommit,
      pullRequests
    }
  }

  return decodeCanonicalUpdateManifest(JSON.stringify(manifest))
}

export async function writeCanonicalUpdateManifest(
  outputPath: string,
  manifest: CanonicalUpdateManifest
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY
  const manifest = await generateCanonicalUpdateManifest({
    expectedHead: process.env.GITHUB_SHA ?? '',
    ...(repository === undefined ? {} : { repository }),
    token: process.env.GITHUB_TOKEN ?? ''
  })
  await writeCanonicalUpdateManifest(
    path.resolve(process.cwd(), process.env.MARKOVER_UPDATE_MANIFEST_OUTPUT ?? OUTPUT_PATH),
    manifest
  )
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Update manifest generation failed: ${message}\n`)
    process.exitCode = 1
  })
}
