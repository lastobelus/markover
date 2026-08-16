import type { AboutPanelOptionsOptions } from 'electron'

import type { BuildIdentity } from './startup-contract'

interface AboutPanelPackageMetadata {
  author: string
  copyright: string
  license: string
}

function requiredString(
  manifest: Record<string, unknown>,
  key: keyof AboutPanelPackageMetadata
): string {
  const value = manifest[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`Markover package metadata must define ${key} as a string.`)
  }
  return value
}

export function aboutPanelPackageMetadata(
  value: unknown
): AboutPanelPackageMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Markover package metadata is invalid.')
  }
  const manifest = value as Record<string, unknown>
  return {
    author: requiredString(manifest, 'author'),
    copyright: requiredString(manifest, 'copyright'),
    license: requiredString(manifest, 'license')
  }
}

export function aboutPanelBuildVersion(build: BuildIdentity): string {
  const commit = build.commit === null ? 'unknown' : build.commit
  return `${commit}${build.dirty ? '-dirty' : ''}`
}

export function aboutPanelOptions(
  applicationName: string,
  build: BuildIdentity,
  packageManifest: unknown
): AboutPanelOptionsOptions {
  const metadata = aboutPanelPackageMetadata(packageManifest)
  return {
    applicationName,
    applicationVersion: build.version,
    version: aboutPanelBuildVersion(build),
    copyright: metadata.copyright,
    credits: `Created by ${metadata.author}. Free and open-source software under the ${metadata.license} License.`
  }
}
