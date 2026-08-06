import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface ReleaseCommandResult {
  status: number
  stderr: string
  stdout: string
}

export type ReleaseCommandRunner = (
  command: string,
  args: readonly string[]
) => ReleaseCommandResult

export interface ReleasePayload {
  architecture: 'arm64' | 'x64' | 'portable'
  name: string
  sha256: string
}

export interface ReleasePayloadReport {
  payloads: readonly ReleasePayload[]
}

export interface ReleaseTagReport {
  commit: string
  previousTag: string
  tag: string
  version: string
}

export interface ReadinessCheck {
  detail: string
  name: string
  state: 'ready' | 'blocked' | 'failed'
}

export interface ReadinessReport {
  checks: readonly ReadinessCheck[]
  state: 'ready' | 'blocked' | 'failed'
}

interface StableSemver {
  major: number
  minor: number
  patch: number
  version: string
}

interface GitHubRelease {
  draft?: unknown
  prerelease?: unknown
  tag_name?: unknown
}

interface CheckRun {
  app?: unknown
  conclusion?: unknown
  name?: unknown
}

interface CheckRunsResponse {
  check_runs?: unknown
}

interface WorkflowRun {
  head_branch?: unknown
  html_url?: unknown
  id?: unknown
  status?: unknown
}

interface PackageManifest {
  version?: unknown
}

interface ToolchainReport {
  architecture: string
  electron: string
  node: string
  npm: string
  os: string
  runner: string
  xcode?: string
}

const projectDirectory = path.resolve(__dirname, '../..')

export const primaryReleaseAssets = [
  'Markover-darwin-arm64.zip',
  'Markover-darwin-x64.zip',
  'markover-cli.tgz'
] as const

export const releaseAssets = primaryReleaseAssets.flatMap((name) => [
  name,
  `${name}.sha256`
])

export const runReleaseCommand: ReleaseCommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

function commandOutput(result: ReleaseCommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim()
}

function requireCommand(
  runner: ReleaseCommandRunner,
  command: string,
  args: readonly string[]
): ReleaseCommandResult {
  const result = runner(command, args)
  if (result.status !== 0) {
    throw new Error(
      commandOutput(result) ||
      `${path.basename(command)} exited ${String(result.status)}`
    )
  }
  return result
}

function parsedJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(`${label} returned invalid JSON.`)
  }
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}

function jsonArrayPages(value: string, label: string): unknown[] {
  const pages = parsedJson(value, label)
  if (!Array.isArray(pages)) {
    throw new Error(`${label} must be a JSON array of pages.`)
  }
  return pages.flatMap((page) => {
    if (!Array.isArray(page)) {
      throw new Error(`${label} contains a non-array page.`)
    }
    return page as unknown[]
  })
}

function jsonObjectPages(value: string, label: string): Record<string, unknown>[] {
  const pages = parsedJson(value, label)
  if (!Array.isArray(pages)) {
    throw new Error(`${label} must be a JSON array of pages.`)
  }
  return pages.map((page) => jsonObject(page, `${label} page`))
}

export function parseStableSemver(value: string): StableSemver {
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Expected a stable SemVer version, found ${value}.`)
  }
  const [major, minor, patch] = match.slice(1).map(Number)
  if (
    major === undefined || minor === undefined || patch === undefined ||
    ![major, minor, patch].every(Number.isSafeInteger)
  ) {
    throw new Error(`Expected a safe stable SemVer version, found ${value}.`)
  }
  return { major, minor, patch, version: value }
}

function parseStableTag(value: string, label: string): StableSemver {
  const match = value.match(/^v(.+)$/)
  if (!match?.[1]) {
    throw new Error(`${label} ${value} must be a v-prefixed stable SemVer tag.`)
  }
  return parseStableSemver(match[1])
}

function compareSemver(left: StableSemver, right: StableSemver): number {
  return left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
}

function packageVersion(rootDirectory: string, relativePath: string): string {
  const manifest = parsedJson(
    fsSync.readFileSync(path.join(rootDirectory, relativePath), 'utf8'),
    relativePath
  ) as PackageManifest
  if (typeof manifest.version !== 'string') {
    throw new Error(`${relativePath} does not declare a version.`)
  }
  return manifest.version
}

function designatedRollbackTag(
  repository: string,
  runner: ReleaseCommandRunner
): string {
  const latestRelease = jsonObject(parsedJson(requireCommand(
    runner,
    'gh',
    ['api', `repos/${repository}/releases/latest`]
  ).stdout, 'Latest GitHub release'), 'Latest GitHub release') as GitHubRelease
  if (
    latestRelease.draft !== false || latestRelease.prerelease !== false ||
    typeof latestRelease.tag_name !== 'string'
  ) {
    throw new Error('The designated latest release must be a published stable release.')
  }
  parseStableTag(latestRelease.tag_name, 'Designated rollback release')
  return latestRelease.tag_name
}

export function verifyReleaseTag({
  commit,
  mainRef,
  repository,
  rootDirectory = projectDirectory,
  runner = runReleaseCommand,
  tag
}: {
  commit: string
  mainRef: string
  repository: string
  rootDirectory?: string
  runner?: ReleaseCommandRunner
  tag: string
}): ReleaseTagReport {
  const version = parseStableTag(tag, 'Release tag')
  const rootVersion = packageVersion(rootDirectory, 'package.json')
  const cliVersion = packageVersion(rootDirectory, 'packages/cli/package.json')
  if (rootVersion !== version.version || cliVersion !== version.version) {
    throw new Error(
      `Tag ${tag}, package.json ${rootVersion}, and CLI ${cliVersion} must match.`
    )
  }

  requireCommand(
    runner,
    'git',
    ['merge-base', '--is-ancestor', commit, mainRef]
  )

  const releasesValue = jsonArrayPages(requireCommand(
    runner,
    'gh',
    [
      'api',
      '--paginate',
      '--slurp',
      `repos/${repository}/releases?per_page=100`
    ]
  ).stdout, 'GitHub releases')
  const publishedVersions = releasesValue
    .map((entry): StableSemver | undefined => {
      const release = jsonObject(entry, 'GitHub release') as GitHubRelease
      if (
        release.draft !== false ||
        release.prerelease !== false ||
        typeof release.tag_name !== 'string'
      ) return undefined
      const match = release.tag_name.match(/^v(.+)$/)
      if (!match?.[1]) return undefined
      try {
        return parseStableSemver(match[1])
      } catch {
        return undefined
      }
    })
    .filter((entry): entry is StableSemver => entry !== undefined)
  const preservedTagVersions = requireCommand(
    runner,
    'git',
    ['tag', '--list', 'v*']
  ).stdout.split(/\r?\n/).flatMap((candidate) => {
    if (!candidate || candidate === tag) return []
    try {
      return [parseStableTag(candidate, 'Preserved release tag')]
    } catch {
      return []
    }
  })
  const newestHistorical = [...publishedVersions, ...preservedTagVersions]
    .sort(compareSemver)
    .at(-1)
  if (!newestHistorical) {
    throw new Error('A preceding stable release is required for rollback.')
  }
  if (compareSemver(version, newestHistorical) <= 0) {
    throw new Error(
      `${tag} must be newer than every stable release tag; newest is v${newestHistorical.version}.`
    )
  }

  const rollbackTag = selectRollbackTarget({ repository, runner, tag })

  const checksValue = jsonObject(parsedJson(requireCommand(
    runner,
    'gh',
    [
      'api',
      `repos/${repository}/commits/${commit}/check-runs?per_page=100&filter=latest`
    ]
  ).stdout, 'GitHub check runs'), 'GitHub check runs') as CheckRunsResponse
  if (!Array.isArray(checksValue.check_runs)) {
    throw new Error('GitHub check runs did not include check_runs.')
  }
  const checkRuns = checksValue.check_runs.map((entry) => (
    jsonObject(entry, 'GitHub check run') as CheckRun
  ))
  for (const name of ['Verify (Node 22.13.0)', 'Verify (Node 24)']) {
    if (!checkRuns.some((check) => (
      check.name === name && check.conclusion === 'success' &&
      check.app !== null && typeof check.app === 'object' &&
      !Array.isArray(check.app) &&
      (check.app as Record<string, unknown>).slug === 'github-actions'
    ))) {
      throw new Error(`${name} has not succeeded for ${commit}.`)
    }
  }

  return {
    commit,
    previousTag: rollbackTag,
    tag,
    version: version.version
  }
}

export function selectRollbackTarget({
  repository,
  tag,
  runner = runReleaseCommand
}: {
  repository: string
  tag: string
  runner?: ReleaseCommandRunner
}): string {
  const version = parseStableTag(tag, 'New release tag')
  const rollbackTag = designatedRollbackTag(repository, runner)
  const rollbackTarget = parseStableTag(rollbackTag, 'Designated rollback release')
  if (compareSemver(rollbackTarget, version) >= 0) {
    throw new Error('The designated rollback release must be older than the new release.')
  }
  return rollbackTag
}

export function verifyRollbackTarget({
  expectedTag,
  repository,
  runner = runReleaseCommand
}: {
  expectedTag: string
  repository: string
  runner?: ReleaseCommandRunner
}): string {
  parseStableTag(expectedTag, 'Expected rollback release')
  const actualTag = designatedRollbackTag(repository, runner)
  if (actualTag !== expectedTag) {
    throw new Error(
      `Rollback release changed from ${expectedTag} to ${actualTag} during staging.`
    )
  }
  return actualTag
}

export function publicationTurnReadiness({
  repository,
  runId,
  runner = runReleaseCommand
}: {
  repository: string
  runId: string
  runner?: ReleaseCommandRunner
}): ReadinessReport {
  if (!/^[1-9]\d*$/.test(runId) || !Number.isSafeInteger(Number(runId))) {
    throw new Error(`Workflow run ID ${runId} must be a positive safe integer.`)
  }
  const currentRunId = Number(runId)
  const pages = jsonObjectPages(requireCommand(
    runner,
    'gh',
    [
      'api',
      '--paginate',
      '--slurp',
      `repos/${repository}/actions/workflows/release.yml/runs?event=push&per_page=100`
    ]
  ).stdout, 'Release workflow runs')
  const runs = pages.flatMap((page) => {
    if (!Array.isArray(page.workflow_runs)) {
      throw new Error('Release workflow run page is missing workflow_runs.')
    }
    return (page.workflow_runs as unknown[]).map((entry) => (
      jsonObject(entry, 'Release workflow run') as WorkflowRun
    ))
  })
  const blockers = runs.filter((run) => {
    if (
      typeof run.id !== 'number' || !Number.isSafeInteger(run.id) ||
      typeof run.status !== 'string' || typeof run.head_branch !== 'string'
    ) {
      throw new Error('Release workflow run contains malformed queue data.')
    }
    return run.id < currentRunId && run.status !== 'completed'
  })
  const check: ReadinessCheck = blockers.length === 0
    ? {
        name: 'Older release runs',
        state: 'ready',
        detail: 'none active'
      }
    : {
        name: 'Older release runs',
        state: 'blocked',
        detail: blockers.map((run) => `${String(run.head_branch)} (#${String(run.id)})`).join(', ')
      }
  return { checks: [check], state: check.state }
}

function architectureForAsset(name: string): ReleasePayload['architecture'] {
  if (name.includes('-arm64.')) return 'arm64'
  if (name.includes('-x64.')) return 'x64'
  return 'portable'
}

function exactValues(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...actual].sort()
  const right = [...expected].sort()
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}

export async function verifyReleasePayloads(
  directory: string
): Promise<ReleasePayloadReport> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const invalidEntries = entries.filter((entry) => (
    !entry.isFile() && !(entry.isDirectory() && entry.name === 'verification')
  ))
  if (invalidEntries.length > 0 || !exactValues(files, releaseAssets)) {
    throw new Error(
      `Release payload set must contain exactly: ${releaseAssets.join(', ')}.`
    )
  }

  const payloads: ReleasePayload[] = []
  for (const name of primaryReleaseAssets) {
    const bytes = await fs.readFile(path.join(directory, name))
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    const sidecar = await fs.readFile(path.join(directory, `${name}.sha256`), 'utf8')
    if (sidecar !== `${sha256}  ${name}\n`) {
      throw new Error(`Checksum sidecar does not exactly match ${name}.`)
    }
    payloads.push({ architecture: architectureForAsset(name), name, sha256 })
  }
  return { payloads }
}

export async function compareReleasePayloads(
  expectedDirectory: string,
  actualDirectory: string
): Promise<ReleasePayloadReport> {
  const expected = await verifyReleasePayloads(expectedDirectory)
  const actual = await verifyReleasePayloads(actualDirectory)
  for (const name of releaseAssets) {
    const expectedBytes = await fs.readFile(path.join(expectedDirectory, name))
    const actualBytes = await fs.readFile(path.join(actualDirectory, name))
    if (!expectedBytes.equals(actualBytes)) {
      throw new Error(`Draft release asset ${name} changed after staging.`)
    }
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Draft release payload reports do not match.')
  }
  return actual
}

function parseToolchainReport(contents: string, label: string): ToolchainReport {
  const values = new Map<string, string>()
  const allowedKeys = new Set([
    'architecture',
    'electron',
    'node',
    'npm',
    'os',
    'runner',
    'xcode'
  ])
  for (const line of contents.trim().split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) throw new Error(`${label} contains an invalid line.`)
    const key = line.slice(0, index)
    const value = line.slice(index + 1)
    if (!allowedKeys.has(key) || values.has(key) || !value || /[\r\n`]/.test(value)) {
      throw new Error(`${label} contains an invalid ${key} value.`)
    }
    values.set(key, value)
  }
  for (const key of ['architecture', 'electron', 'node', 'npm', 'os', 'runner']) {
    if (!values.has(key)) throw new Error(`${label} is missing ${key}.`)
  }
  return {
    architecture: values.get('architecture') ?? '',
    electron: values.get('electron') ?? '',
    node: values.get('node') ?? '',
    npm: values.get('npm') ?? '',
    os: values.get('os') ?? '',
    runner: values.get('runner') ?? '',
    ...(values.has('xcode') ? { xcode: values.get('xcode') ?? '' } : {})
  }
}

async function toolchainReports(directory: string): Promise<ToolchainReport[]> {
  const expected = ['macos-arm64.txt', 'macos-x64.txt', 'cli.txt']
  const expectedArchitectures = ['arm64', 'x64', 'portable']
  const entries = await fs.readdir(directory)
  if (!exactValues(entries, expected)) {
    throw new Error(`Verification context must contain exactly: ${expected.join(', ')}.`)
  }
  const reports = await Promise.all(expected.map(async (name) => (
    parseToolchainReport(await fs.readFile(path.join(directory, name), 'utf8'), name)
  )))
  reports.forEach((report, index) => {
    if (report.architecture !== expectedArchitectures[index]) {
      throw new Error(`${expected[index]} reports the wrong architecture.`)
    }
    if ((index < 2) !== Boolean(report.xcode)) {
      throw new Error(`${expected[index]} reports an invalid Xcode context.`)
    }
  })
  return reports
}

export async function generateReleaseNotes({
  commit,
  directory,
  previousTag,
  repository,
  runId,
  tag,
  verificationDirectory
}: {
  commit: string
  directory: string
  previousTag: string
  repository: string
  runId: string
  tag: string
  verificationDirectory: string
}): Promise<string> {
  const payloadReport = await verifyReleasePayloads(directory)
  const toolchains = await toolchainReports(verificationDirectory)
  const version = parseStableTag(tag, 'Release tag').version
  parseStableTag(previousTag, 'Previous release tag')
  const payloadRows = payloadReport.payloads.map((payload) => (
    `| \`${payload.name}\` | ${payload.architecture} | \`${payload.sha256}\` |`
  )).join('\n')
  const toolchainRows = toolchains.map((toolchain) => {
    const xcode = toolchain.xcode ? `; ${toolchain.xcode}` : ''
    return `- ${toolchain.architecture}: ${toolchain.runner}; ${toolchain.os}; Node ${toolchain.node}; npm ${toolchain.npm}; Electron ${toolchain.electron}${xcode}`
  }).join('\n')
  const rollbackUrl = `https://github.com/${repository}/releases/download/${previousTag}/markover-cli.tgz`
  return `# Markover ${tag}

> **Not Apple-verified.** These macOS apps use hardened ad-hoc signing. They do not identify an authenticated Developer ID publisher, are not notarized, and are expected to require the documented per-app Gatekeeper override.

## Provenance

- Source: [\`${tag}\`](https://github.com/${repository}/tree/${tag}) at [\`${commit}\`](https://github.com/${repository}/commit/${commit})
- Workflow: [GitHub Actions run ${runId}](https://github.com/${repository}/actions/runs/${runId})
- Version: \`${version}\`
- Trust mode: hardened ad-hoc signing; Gatekeeper rejection verified before upload

| Payload | Architecture | SHA-256 |
| --- | --- | --- |
${payloadRows}

GitHub build-provenance attestations cover the two app ZIPs and \`markover-cli.tgz\`. After downloading a payload, verify it with:

\`\`\`sh
gh attestation verify ./PAYLOAD \\
  --repo ${repository} \\
  --signer-workflow ${repository}/.github/workflows/release.yml \\
  --source-digest ${commit} \\
  --source-ref refs/tags/${tag} \\
  --deny-self-hosted-runners
\`\`\`

These records identify the source and workflow that produced the bytes; they do not claim bit-for-bit reproducibility.

## Resolved build context

${toolchainRows}

## Roll back to ${previousTag}

Quit Markover and back up the complete \`~/Library/Application Support/Markover\` directory before rolling back. Rollback is supported only while both releases use the same review-data format.

\`\`\`sh
npx --yes \\
  --package=${rollbackUrl} \\
  markover open ./DOCUMENT.md \\
  --summary "Explain why this document exists and what feedback would help."
\`\`\`

Published assets are never replaced under an existing tag. If this release is withdrawn, use ${previousTag} until a newly versioned fix is published.
`
}

export async function verifyDraftRelease({
  notesPath,
  releasePath,
  tag
}: {
  notesPath: string
  releasePath: string
  tag: string
}): Promise<void> {
  const release = jsonObject(parsedJson(
    await fs.readFile(releasePath, 'utf8'),
    'Draft release'
  ), 'Draft release')
  const notes = await fs.readFile(notesPath, 'utf8')
  if (
    release.tag_name !== tag ||
    release.name !== `Markover ${tag}` ||
    release.body !== notes ||
    release.draft !== true ||
    release.prerelease !== false
  ) {
    throw new Error('Draft release metadata changed after staging.')
  }
  if (!Array.isArray(release.assets)) {
    throw new Error('Draft release assets must be a JSON array.')
  }
  const names = release.assets.map((entry) => {
    const asset = jsonObject(entry, 'Draft release asset')
    if (typeof asset.name !== 'string') {
      throw new Error('Draft release asset is missing its name.')
    }
    return asset.name
  })
  if (!exactValues(names, releaseAssets)) {
    throw new Error('Draft release has an unexpected asset set.')
  }
}

function readinessState(checks: readonly ReadinessCheck[]): ReadinessReport['state'] {
  if (checks.some((check) => check.state === 'failed')) return 'failed'
  if (checks.some((check) => check.state === 'blocked')) return 'blocked'
  return 'ready'
}

function failedCheck(name: string, result: ReleaseCommandResult): ReadinessCheck {
  return {
    name,
    state: 'failed',
    detail: commandOutput(result) || 'GitHub did not return this setting.'
  }
}

function isNotFound(result: ReleaseCommandResult): boolean {
  return result.status !== 0 && (
    /\bNot Found\b/i.test(commandOutput(result)) ||
    /["']status["']\s*:\s*["']?404\b/.test(commandOutput(result))
  )
}

export function githubReleaseReadiness(
  repository: string,
  runner: ReleaseCommandRunner = runReleaseCommand
): ReadinessReport {
  const checks: ReadinessCheck[] = []
  const [repositoryOwner, repositoryName, ...extraParts] = repository.split('/')
  if (!repositoryOwner || !repositoryName || extraParts.length > 0) {
    throw new Error(`Repository ${repository} must use owner/name format.`)
  }

  const immutable = runner('gh', ['api', `repos/${repository}/immutable-releases`])
  if (immutable.status !== 0) {
    checks.push(failedCheck('Immutable releases', immutable))
  } else {
    const value = jsonObject(parsedJson(
      immutable.stdout,
      'Immutable release setting'
    ), 'Immutable release setting')
    checks.push(value.enabled === true
      ? { name: 'Immutable releases', state: 'ready', detail: 'enabled' }
      : { name: 'Immutable releases', state: 'blocked', detail: 'disabled' })
  }

  const environment = runner('gh', [
    'api',
    `repos/${repository}/environments/release`
  ])
  if (isNotFound(environment)) {
    checks.push({
      name: 'Protected release environment',
      state: 'blocked',
      detail: 'missing'
    })
  } else if (environment.status !== 0) {
    checks.push(failedCheck('Protected release environment', environment))
  } else {
    const value = jsonObject(parsedJson(
      environment.stdout,
      'Release environment'
    ), 'Release environment')
    const rules = Array.isArray(value.protection_rules)
      ? value.protection_rules.map((entry) => jsonObject(entry, 'Protection rule'))
      : []
    const reviewerRule = rules.find((rule) => rule.type === 'required_reviewers')
    const reviewers = reviewerRule && Array.isArray(reviewerRule.reviewers)
      ? reviewerRule.reviewers
      : []
    const soleReviewer = reviewers.length === 1
      ? jsonObject(reviewers[0], 'Release environment reviewer')
      : undefined
    const reviewer = soleReviewer?.reviewer &&
      typeof soleReviewer.reviewer === 'object' &&
      !Array.isArray(soleReviewer.reviewer)
      ? soleReviewer.reviewer as Record<string, unknown>
      : undefined
    const deploymentPolicy = value.deployment_branch_policy
    const policySettings = deploymentPolicy &&
      typeof deploymentPolicy === 'object' &&
      !Array.isArray(deploymentPolicy)
      ? deploymentPolicy as Record<string, unknown>
      : undefined
    if (
      !reviewerRule || soleReviewer?.type !== 'User' ||
      reviewer?.login !== repositoryOwner ||
      reviewerRule.prevent_self_review !== false ||
      policySettings?.custom_branch_policies !== true ||
      policySettings.protected_branches !== false
    ) {
      checks.push({
        name: 'Protected release environment',
        state: 'blocked',
        detail: 'must require only the repository owner, permit self-approval, and use custom tag policies'
      })
    } else {
      const policies = runner('gh', [
        'api',
        `repos/${repository}/environments/release/deployment-branch-policies?per_page=100`
      ])
      if (policies.status !== 0) {
        checks.push(failedCheck('Protected release environment', policies))
      } else {
        const policyResponse = jsonObject(parsedJson(
          policies.stdout,
          'Release deployment policies'
        ), 'Release deployment policies')
        const branchPolicies = Array.isArray(policyResponse.branch_policies)
          ? policyResponse.branch_policies.map((entry) => (
              jsonObject(entry, 'Release deployment policy')
            ))
          : []
        checks.push(branchPolicies.some((policy) => (
          policy.name === 'v*' && policy.type === 'tag'
        ))
          ? {
              name: 'Protected release environment',
              state: 'ready',
              detail: 'approval required; self-approval permitted; v* tags allowed'
            }
          : {
              name: 'Protected release environment',
              state: 'blocked',
              detail: 'custom deployment policy must allow v* tags'
            })
      }
    }
  }

  const rulesets = runner('gh', [
    'api',
    '--paginate',
    '--slurp',
    `repos/${repository}/rulesets?per_page=100`
  ])
  if (rulesets.status !== 0) {
    checks.push(failedCheck('Protected v* tags', rulesets))
  } else {
    const ownerResult = runner('gh', ['api', `users/${repositoryOwner}`])
    if (ownerResult.status !== 0) {
      checks.push(failedCheck('Protected v* tags', ownerResult))
      return { checks, state: readinessState(checks) }
    }
    const owner = jsonObject(parsedJson(
      ownerResult.stdout,
      'Repository owner'
    ), 'Repository owner')
    if (typeof owner.id !== 'number') {
      throw new Error('Repository owner is missing its numeric ID.')
    }
    const summaries = jsonArrayPages(rulesets.stdout, 'Repository rulesets')
    const tagSummaries = summaries
      .map((entry) => jsonObject(entry, 'Repository ruleset'))
      .filter((entry) => (
        entry.target === 'tag' && entry.enforcement === 'active' &&
        typeof entry.id === 'number'
      ))
    let creationRestricted = false
    let mutationBlocked = false
    let detailFailure: ReleaseCommandResult | undefined
    for (const summary of tagSummaries) {
      const detailResult = runner('gh', [
        'api',
        `repos/${repository}/rulesets/${String(summary.id)}`
      ])
      if (detailResult.status !== 0) {
        detailFailure ??= detailResult
        continue
      }
      const detail = jsonObject(parsedJson(
        detailResult.stdout,
        'Tag ruleset'
      ), 'Tag ruleset')
      const conditions = jsonObject(detail.conditions, 'Tag ruleset conditions')
      const refName = jsonObject(conditions.ref_name, 'Tag ruleset ref condition')
      const includes = Array.isArray(refName.include) ? refName.include : undefined
      const excludes = Array.isArray(refName.exclude) ? refName.exclude : undefined
      const ruleTypes = Array.isArray(detail.rules)
        ? detail.rules.map((entry) => jsonObject(entry, 'Tag rule').type)
        : []
      const bypassActors = Array.isArray(detail.bypass_actors)
        ? detail.bypass_actors.map((entry) => jsonObject(entry, 'Bypass actor'))
        : []
      if (
        !includes?.includes('refs/tags/v*') ||
        excludes === undefined || excludes.length > 0
      ) continue
      if (
        ruleTypes.includes('creation') && bypassActors.length === 1 &&
        bypassActors[0]?.actor_type === 'User' &&
        bypassActors[0].actor_id === owner.id &&
        bypassActors[0].bypass_mode === 'always'
      ) {
        creationRestricted = true
      }
      if (
        ruleTypes.includes('update') &&
        ruleTypes.includes('deletion') &&
        bypassActors.length === 0
      ) mutationBlocked = true
    }
    checks.push(detailFailure
      ? failedCheck('Protected v* tags', detailFailure)
      : creationRestricted && mutationBlocked
      ? {
          name: 'Protected v* tags',
          state: 'ready',
          detail: 'creation restricted; updates and deletion blocked'
        }
        : {
            name: 'Protected v* tags',
            state: 'blocked',
            detail: 'requires maintainer-only creation plus unbypassable update/deletion rules'
          })
  }

  return { checks, state: readinessState(checks) }
}

export function developerIdReadiness(): ReadinessReport {
  const checks: ReadinessCheck[] = [{
    name: 'Developer ID trust mode',
    state: 'blocked',
    detail: 'repository contract intentionally supports ad-hoc signing only'
  }]
  return { checks, state: 'blocked' }
}
