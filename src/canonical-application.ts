import path from 'node:path'

import {
  DEVELOPMENT_BUNDLE_ID_PREFIX,
  developmentGeneratedRoot,
  type ResolvedInstance
} from './instance'

export const INSTALLED_CANONICAL_APPLICATION_PATH =
  '/Applications/Markover.app'

export interface CanonicalApplicationAddress {
  bundleIdentifier: string
  generatedAppPath: string
  generatedExecutablePath: string
  installedAppPath: string
  installedExecutablePath: string
}

function executablePath(appPath: string, appName: string): string {
  return path.join(appPath, 'Contents', 'MacOS', appName)
}

export function canonicalApplicationAddress(
  instance: ResolvedInstance
): CanonicalApplicationAddress {
  if (instance.identity.kind !== 'canonical' || !instance.checkout) {
    throw new Error('Canonical application addressing requires its checkout.')
  }
  const appName = instance.branding.appName
  const generatedAppPath = path.join(
    developmentGeneratedRoot(instance.checkout),
    'canonical',
    'bundle',
    `${appName}.app`
  )
  return {
    bundleIdentifier: `${DEVELOPMENT_BUNDLE_ID_PREFIX}.canonical`,
    generatedAppPath,
    generatedExecutablePath: executablePath(generatedAppPath, appName),
    installedAppPath: INSTALLED_CANONICAL_APPLICATION_PATH,
    installedExecutablePath: executablePath(
      INSTALLED_CANONICAL_APPLICATION_PATH,
      appName
    )
  }
}
