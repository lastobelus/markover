import path from 'node:path'

export const appBundleId = 'com.lastobelus.markover'
export const helperBundleId = `${appBundleId}.helper`
export const minimumMacosVersion = '14.0'

export type MacosArchitecture = 'arm64' | 'x64'
export type MacosTrustMode = 'ad-hoc'

export interface SignedAppComponent {
  bundleId: string
  entitlementFile: string
  entitlements: Readonly<Record<string, boolean>>
  relativePath: string
}

const allowJit = { 'com.apple.security.cs.allow-jit': true } as const

export const signedAppComponents: readonly SignedAppComponent[] = [
  {
    relativePath: '',
    bundleId: appBundleId,
    entitlementFile: 'app.plist',
    entitlements: allowJit
  },
  {
    relativePath: 'Contents/Frameworks/Markover Helper.app',
    bundleId: helperBundleId,
    entitlementFile: 'helper.plist',
    entitlements: allowJit
  },
  {
    relativePath: 'Contents/Frameworks/Markover Helper (GPU).app',
    // @electron/packager deliberately reuses an explicitly configured
    // --helper-bundle-id for the GPU, Plugin, and Renderer helpers.
    bundleId: helperBundleId,
    entitlementFile: 'helper-gpu.plist',
    entitlements: allowJit
  },
  {
    relativePath: 'Contents/Frameworks/Markover Helper (Plugin).app',
    bundleId: helperBundleId,
    entitlementFile: 'helper-plugin.plist',
    entitlements: {}
  },
  {
    relativePath: 'Contents/Frameworks/Markover Helper (Renderer).app',
    bundleId: helperBundleId,
    entitlementFile: 'helper-renderer.plist',
    entitlements: allowJit
  }
]

export function parseMacosArchitecture(value: string): MacosArchitecture {
  if (value !== 'arm64' && value !== 'x64') {
    throw new Error(`Unsupported macOS architecture: ${value}`)
  }
  return value
}

export function machOArchitecture(
  architecture: MacosArchitecture
): 'arm64' | 'x86_64' {
  return architecture === 'x64' ? 'x86_64' : architecture
}

export function parseMacosTrustMode(value: string | undefined): MacosTrustMode {
  if (value !== 'ad-hoc') {
    throw new Error(
      value === undefined
        ? 'The macOS trust mode is required.'
        : `Unsupported macOS trust mode: ${value}`
    )
  }
  return value
}

export function expectedArchiveName(
  architecture: MacosArchitecture
): string {
  return `Markover-darwin-${architecture}.zip`
}

export function entitlementsDirectory(rootDirectory: string): string {
  return path.join(rootDirectory, 'config', 'macos', 'entitlements')
}

export function entitlementsForSignedFile(
  appPath: string,
  filePath: string,
  rootDirectory: string
): string {
  const component = signedComponentForFile(appPath, filePath)
  const entitlementFile = component?.entitlementFile ?? 'code.plist'
  return path.join(entitlementsDirectory(rootDirectory), entitlementFile)
}

export function expectedEntitlementsForSignedFile(
  appPath: string,
  filePath: string
): Readonly<Record<string, boolean>> {
  return signedComponentForFile(appPath, filePath)?.entitlements ?? {}
}

function signedComponentForFile(
  appPath: string,
  filePath: string
): SignedAppComponent | undefined {
  const relativePath = path.relative(appPath, filePath)
  if (
    relativePath === '' ||
    relativePath === path.join('Contents', 'MacOS', 'Markover')
  ) {
    return signedAppComponents[0]
  }
  const component = signedAppComponents
    .filter(({ relativePath: componentPath }) => componentPath !== '')
    .find(({ relativePath: componentPath }) => (
      relativePath === componentPath ||
      relativePath.startsWith(`${componentPath}${path.sep}`)
    ))
  return component
}
