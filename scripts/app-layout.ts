import fs from 'node:fs/promises'
import path from 'node:path'

export const runtimeModuleNames = [
  'agent-guidance',
  'app-menu',
  'local-service',
  'main',
  'metadata-discovery',
  'preload',
  'review-migration',
  'review-store',
  'service-endpoint',
  'settings',
  'settings-store'
] as const

export const brandAssetNames = [
  'markover-app-icon.png',
  'markover-lockup.svg',
  'markover-logotype.svg',
  'markover-mark.svg'
] as const

export const expectedStageEntries = [
  'package.json',
  ...runtimeModuleNames.flatMap((name) => [
    `src/${name}.js`,
    `src/${name}.js.map`
  ]),
  'src/index.html',
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

  const renderer = await fs.readFile(
    path.join(appDirectory, 'src/renderer.js'),
    'utf8'
  )
  for (const forbidden of ['../node_modules/', 'src/vendor/']) {
    if (renderer.includes(forbidden)) {
      throw new Error(`Renderer bundle contains a forbidden runtime path: ${forbidden}`)
    }
  }
}
