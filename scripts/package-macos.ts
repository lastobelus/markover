#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  entitlementsForSignedFile,
  minimumMacosVersion,
  parseMacosTrustMode
} from './macos-release-contract'

const projectDirectory = path.resolve(__dirname, '../..')
const appDirectory = path.join(projectDirectory, 'build/app')
const packagerPath = path.join(
  projectDirectory,
  'node_modules/.bin/electron-packager'
)

export interface CopyThirdPartyNoticesOptions {
  rootDirectory?: string
}

export interface AdHocSigningOptions {
  app: string
  identity: '-'
  identityValidation: false
  optionsForFile: (filePath: string) => {
    entitlements: string
    hardenedRuntime: true
    timestamp: 'none'
  }
  platform: 'darwin'
  preAutoEntitlements: false
  preEmbedProvisioningProfile: false
  strictVerify: true
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

export function adHocSigningOptions(
  appPath: string,
  rootDirectory = projectDirectory
): AdHocSigningOptions {
  return {
    app: appPath,
    platform: 'darwin',
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    optionsForFile(filePath: string) {
      return {
        entitlements: entitlementsForSignedFile(
          appPath,
          filePath,
          rootDirectory
        ),
        hardenedRuntime: true,
        timestamp: 'none'
      }
    }
  }
}

export function setMinimumSystemVersion(appPath: string): void {
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist')
  const result = spawnSync(
    '/usr/bin/plutil',
    [
      '-replace',
      'LSMinimumSystemVersion',
      '-string',
      minimumMacosVersion,
      infoPlist
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `plutil exited ${String(result.status)}`
    )
  }
}

function trustModeArgument(args: readonly string[]): string | undefined {
  if (args.length !== 1 || !args[0]?.startsWith('--trust-mode=')) {
    return undefined
  }
  return args[0].slice('--trust-mode='.length)
}

export async function main(commandArguments = process.argv.slice(2)): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Packaging Markover for macOS requires macOS.')
  }
  parseMacosTrustMode(trustModeArgument(commandArguments))

  const manifest = JSON.parse(fs.readFileSync(
    path.join(projectDirectory, 'package.json'),
    'utf8'
  )) as { devDependencies?: { electron?: string } }
  const electronVersion = manifest.devDependencies?.electron
  if (!electronVersion) throw new Error('package.json must pin Electron.')

  const packagerArguments = [
    appDirectory,
    'Markover',
    '--platform=darwin',
    `--arch=${process.arch}`,
    `--electron-version=${electronVersion}`,
    '--out=dist',
    '--overwrite',
    '--asar',
    `--icon=${path.join(projectDirectory, 'design/brand/markover-app-icon.icns')}`,
    '--prune=false',
    '--app-bundle-id=com.lastobelus.markover',
    '--helper-bundle-id=com.lastobelus.markover.helper',
    '--app-category-type=public.app-category.developer-tools'
  ]
  const result = spawnSync(packagerPath, packagerArguments, {
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
  setMinimumSystemVersion(appPath)
  const { sign } = await import('@electron/osx-sign')
  await sign(adHocSigningOptions(appPath))
  process.stdout.write(result.stdout)
  process.stdout.write(
    'Created a hardened ad-hoc-signed build; it is not Apple-verified or notarized.\n'
  )
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover package: ${message}\n`)
    process.exit(1)
  })
}
