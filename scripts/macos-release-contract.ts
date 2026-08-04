import path from 'node:path'

export const appBundleId = 'com.lastobelus.markover'
export const helperBundleId = `${appBundleId}.helper`
export const minimumMacosVersion = '14.0'

export type MacosArchitecture = 'arm64' | 'x64'
export type MacosTrustMode = 'ad-hoc'

export interface SignedAppComponent {
  bundleId: string
  entitlementFile: string
  entitlementKeys: readonly string[]
  relativePath: string
}

const allowJit = ['com.apple.security.cs.allow-jit'] as const

export const signedAppComponents: readonly SignedAppComponent[] = [
  {
    relativePath: '',
    bundleId: appBundleId,
    entitlementFile: 'app.plist',
    entitlementKeys: allowJit
  },
  {
    relativePath: 'Contents/Frameworks/Markover Helper.app',
    bundleId: helperBundleId,
    entitlementFile: 'helper.plist',
    entitlementKeys: allowJit
  },
  {
    relativePath: 'Contents/Frameworks/Markover Helper (GPU).app',
    bundleId: helperBundleId,
    entitlementFile: 'helper-gpu.plist',
    entitlementKeys: allowJit
  },
  {
    relativePath: 'Contents/Frameworks/Markover Helper (Plugin).app',
    bundleId: helperBundleId,
    entitlementFile: 'helper-plugin.plist',
    entitlementKeys: []
  },
  {
    relativePath: 'Contents/Frameworks/Markover Helper (Renderer).app',
    bundleId: helperBundleId,
    entitlementFile: 'helper-renderer.plist',
    entitlementKeys: allowJit
  }
]

export function parseMacosArchitecture(value: string): MacosArchitecture {
  if (value !== 'arm64' && value !== 'x64') {
    throw new Error(`Unsupported macOS architecture: ${value}`)
  }
  return value
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

export function entitlementKeysForSignedFile(
  appPath: string,
  filePath: string
): readonly string[] {
  return signedComponentForFile(appPath, filePath)?.entitlementKeys ?? []
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
