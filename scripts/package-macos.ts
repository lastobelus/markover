#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const projectDirectory = path.resolve(__dirname, '../..')
const packagerPath = path.join(
  projectDirectory,
  'node_modules/.bin/electron-packager'
)

export interface CopyThirdPartyNoticesOptions {
  rootDirectory?: string
}

export function copyThirdPartyNotices(
  appPath: string,
  { rootDirectory = projectDirectory }: CopyThirdPartyNoticesOptions = {}
): void {
  const licensesDirectory = path.join(
    appPath,
    'Contents',
    'Resources',
    'licenses'
  )
  fs.mkdirSync(licensesDirectory, { recursive: true })
  const notices: Array<readonly [string, string]> = [
    [path.join(rootDirectory, 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md'],
    [path.join(rootDirectory, 'node_modules/electron/dist/LICENSE'), 'ELECTRON_LICENSE'],
    [path.join(rootDirectory, 'node_modules/electron/dist/LICENSES.chromium.html'), 'CHROMIUM_LICENSES.html']
  ]
  for (const [source, name] of notices) {
    fs.copyFileSync(source, path.join(licensesDirectory, name))
  }
}

export function main(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Packaging Markover for macOS requires macOS.')
  }

  const args = [
    projectDirectory,
    'Markover',
    '--platform=darwin',
    `--arch=${process.arch}`,
    '--out=dist',
    '--overwrite',
    '--asar',
    '--icon=design/brand/markover-app-icon.icns',
    '--app-bundle-id=com.lastobelus.markover',
    '--helper-bundle-id=com.lastobelus.markover.helper',
    '--app-category-type=public.app-category.developer-tools',
    '--ignore=^/(?:\\.git|\\.markover|dist|doc|docs|examples|packages|scripts|src|test|third_party|tmp)(?:/|$)',
    '--ignore=^/build/(?:\\.github|docs|examples|packages|scripts|test)(?:/|$)',
    '--ignore=^/design(?:/|$)',
    '--ignore=^/(?:\\.editorconfig|\\.github|\\.gitignore|AGENTS\\.md|CODE_OF_CONDUCT\\.md|CONTRIBUTING\\.md|DECISIONS\\.md|README\\.md|ROADMAP\\.md|SCREENSHOT-ATTACHMENT-QUESTIONS\\.md|SECURITY\\.md|THIRD_PARTY_NOTICES\\.md|eslint\\.config\\.js|favicon\\.svg|tsconfig\\.json)$',
    '--ignore=\\.af$'
  ]
  const result = spawnSync(packagerPath, args, {
    cwd: projectDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `electron-packager exited ${String(result.status)}`
    )
  }
  const appPath = path.join(
    projectDirectory,
    'dist',
    `Markover-darwin-${process.arch}`,
    'Markover.app'
  )
  copyThirdPartyNotices(appPath)
  const signing = spawnSync(
    '/usr/bin/codesign',
    ['--force', '--deep', '--sign', '-', appPath],
    { encoding: 'utf8' }
  )
  if (signing.status !== 0) {
    throw new Error(
      signing.stderr.trim() || `codesign exited ${String(signing.status)}`
    )
  }
  process.stdout.write(result.stdout)
  process.stdout.write('Created a local ad-hoc-signed build; it is not notarized for distribution.\n')
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover package: ${message}\n`)
    process.exit(1)
  }
}
