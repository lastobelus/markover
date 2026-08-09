import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { rendererContentSecurityPolicy } from '../src/renderer-security'

export const runtimeModuleNames = [
  'agent-guidance',
  'app-menu',
  'async-mutation-tracker',
  'development-config',
  'durability-shutdown',
  'ipc-contract',
  'ipc-security',
  'instance',
  'local-client',
  'local-service',
  'main',
  'metadata-discovery',
  'protocol-registration',
  'review-autosave',
  'review-migration',
  'review-store',
  'review-url',
  'review-url-dispatcher',
  'renderer-security',
  'service-endpoint',
  'settings',
  'settings-store',
  'smoke-fixture',
  'startup-contract',
  'startup-diagnostic'
] as const

export const brandAssetNames = [
  'markover-app-icon.png',
  'markover-lockup.svg',
  'markover-logotype.svg',
  'markover-mark.svg'
] as const

export const expectedStageEntries = [
  'build-identity.json',
  'package.json',
  ...runtimeModuleNames.flatMap((name) => [
    `src/${name}.js`,
    `src/${name}.js.map`
  ]),
  'src/index.html',
  'src/preload.js',
  'src/preload.js.map',
  'src/renderer.js',
  'src/renderer.js.map',
  'src/startup.js',
  'src/startup.js.map',
  'src/styles.css',
  ...brandAssetNames.map((name) => `design/brand/${name}`)
].sort()

async function entriesBelow(
  directory: string,
  relativeDirectory = ''
): Promise<string[]> {
  const entries = await fs.readdir(path.join(directory, relativeDirectory), {
    withFileTypes: true
  })
  const result: string[] = []
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Application stage contains a symlink: ${relativePath}`)
    }
    if (entry.isDirectory()) {
      result.push(...await entriesBelow(directory, relativePath))
    } else if (entry.isFile()) {
      result.push(relativePath)
    } else {
      throw new Error(`Application stage contains an unsupported entry: ${relativePath}`)
    }
  }
  return result.sort()
}

function exactDifference(left: readonly string[], right: readonly string[]): string[] {
  const expected = new Set(right)
  return left.filter((entry) => !expected.has(entry))
}

export async function verifyAppLayout(appDirectory: string): Promise<void> {
  const actualEntries = await entriesBelow(appDirectory)
  const missing = exactDifference(expectedStageEntries, actualEntries)
  const unexpected = exactDifference(actualEntries, expectedStageEntries)
  if (missing.length || unexpected.length) {
    throw new Error([
      'Application stage does not match its allow-list.',
      ...(missing.length ? [`Missing: ${missing.join(', ')}`] : []),
      ...(unexpected.length ? [`Unexpected: ${unexpected.join(', ')}`] : [])
    ].join('\n'))
  }

  const actualEntrySet = new Set(actualEntries)
  for (const moduleName of runtimeModuleNames) {
    const modulePath = path.join(appDirectory, 'src', `${moduleName}.js`)
    const source = await fs.readFile(modulePath, 'utf8')
    for (const match of source.matchAll(/require\(["'](\.\.?\/[^"']+)["']\)/g)) {
      const request = match[1]
      if (!request) continue
      const target = path.posix.normalize(path.posix.join(
        'src',
        request.endsWith('.js') ? request : `${request}.js`
      ))
      if (!actualEntrySet.has(target)) {
        throw new Error(
          `Staged runtime module ${moduleName} requires missing ${target}.`
        )
      }
    }
  }

  const manifest: unknown = JSON.parse(await fs.readFile(
    path.join(appDirectory, 'package.json'),
    'utf8'
  ))
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    Reflect.get(manifest, 'main') !== 'src/main.js'
  ) {
    throw new Error('Staged package.json must use src/main.js as its entry point.')
  }

  const rendererBuffer = await fs.readFile(
    path.join(appDirectory, 'src/renderer.js')
  )
  const rendererSha256 = crypto.createHash('sha256')
    .update(rendererBuffer)
    .digest('hex')
  const buildIdentity: unknown = JSON.parse(await fs.readFile(
    path.join(appDirectory, 'build-identity.json'),
    'utf8'
  ))
  if (
    buildIdentity === null ||
    typeof buildIdentity !== 'object' ||
    !Reflect.get(buildIdentity, 'version') ||
    typeof Reflect.get(buildIdentity, 'version') !== 'string' ||
    (
      Reflect.get(buildIdentity, 'commit') !== null &&
      typeof Reflect.get(buildIdentity, 'commit') !== 'string'
    ) ||
    typeof Reflect.get(buildIdentity, 'dirty') !== 'boolean' ||
    Reflect.get(buildIdentity, 'rendererSha256') !== rendererSha256
  ) {
    throw new Error('Staged build identity is invalid.')
  }

  const html = await fs.readFile(path.join(appDirectory, 'src/index.html'), 'utf8')
  for (const required of [
    'http-equiv="Content-Security-Policy"',
    'src="startup.js"',
    'type="module" src="renderer.js"'
  ]) {
    if (!html.includes(required)) {
      throw new Error(`Staged HTML is missing required markup: ${required}`)
    }
  }
  for (const forbidden of ['<script type="importmap">', 'node_modules', 'vendor/']) {
    if (html.includes(forbidden)) {
      throw new Error(`Staged HTML contains a forbidden runtime reference: ${forbidden}`)
    }
  }
  const policyTag = html.match(
    /<meta\b(?=[^>]*http-equiv="Content-Security-Policy")[^>]*>/i
  )?.[0]
  const policy = policyTag?.match(/\bcontent="([^"]+)"/i)?.[1]
  if (policy !== rendererContentSecurityPolicy) {
    throw new Error('Staged HTML has an unexpected Content Security Policy.')
  }

  const renderer = rendererBuffer.toString('utf8')
  for (const forbidden of ['../node_modules/', 'src/vendor/']) {
    if (renderer.includes(forbidden)) {
      throw new Error(`Renderer bundle contains a forbidden runtime path: ${forbidden}`)
    }
  }
}
