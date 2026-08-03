#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const projectDirectory = path.resolve(__dirname, '..')
const packagerPath = path.join(
  projectDirectory,
  'node_modules/.bin/electron-packager'
)

function copyThirdPartyNotices(appPath, { rootDirectory = projectDirectory } = {}) {
  const licensesDirectory = path.join(
    appPath,
    'Contents',
    'Resources',
    'licenses'
  )
  fs.mkdirSync(licensesDirectory, { recursive: true })
  for (const [source, name] of [
    [path.join(rootDirectory, 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md'],
    [path.join(rootDirectory, 'node_modules/electron/dist/LICENSE'), 'ELECTRON_LICENSE'],
    [path.join(rootDirectory, 'node_modules/electron/dist/LICENSES.chromium.html'), 'CHROMIUM_LICENSES.html']
  ]) {
    fs.copyFileSync(source, path.join(licensesDirectory, name))
  }
}

function main() {
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
    '--ignore=^/(?:\\.git|\\.markover|dist|doc|docs|examples|scripts|test|tmp)(?:/|$)',
    '--ignore=^/design/(?:logo-explorations|brand/mockups)(?:/|$)',
    '--ignore=^/(?:AGENTS\\.md|DECISIONS\\.md|README\\.md|SCREENSHOT-ATTACHMENT-QUESTIONS\\.md|favicon\\.svg)$',
    '--ignore=\\.af$'
  ]
  const result = spawnSync(packagerPath, args, {
    cwd: projectDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `electron-packager exited ${result.status}`
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
      signing.stderr.trim() || `codesign exited ${signing.status}`
    )
  }
  process.stdout.write(result.stdout)
  process.stdout.write('Created a local ad-hoc-signed build; it is not notarized for distribution.\n')
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`markover package: ${error.message}\n`)
    process.exit(1)
  }
}

module.exports = { copyThirdPartyNotices, main }
