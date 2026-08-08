import {
  assertMacosFusePolicy,
  macosFusePolicy,
  type MacosFuseName,
  type MacosFusePolicy
} from './macos-release-contract'

export async function readMacosFusePolicy(
  appPath: string
): Promise<MacosFusePolicy> {
  const {
    FuseState,
    FuseV1Options,
    getCurrentFuseWire
  } = await import('@electron/fuses')
  const wire = await getCurrentFuseWire(appPath)
  const wireVersion: string = wire.version
  if (wireVersion !== '1') {
    throw new Error(`Unsupported Electron fuse wire version: ${wireVersion}`)
  }
  const options: ReadonlyArray<readonly [MacosFuseName, number]> = [
    ['RunAsNode', FuseV1Options.RunAsNode],
    ['EnableCookieEncryption', FuseV1Options.EnableCookieEncryption],
    [
      'EnableNodeOptionsEnvironmentVariable',
      FuseV1Options.EnableNodeOptionsEnvironmentVariable
    ],
    [
      'EnableNodeCliInspectArguments',
      FuseV1Options.EnableNodeCliInspectArguments
    ],
    [
      'EnableEmbeddedAsarIntegrityValidation',
      FuseV1Options.EnableEmbeddedAsarIntegrityValidation
    ],
    ['OnlyLoadAppFromAsar', FuseV1Options.OnlyLoadAppFromAsar],
    [
      'LoadBrowserProcessSpecificV8Snapshot',
      FuseV1Options.LoadBrowserProcessSpecificV8Snapshot
    ],
    [
      'GrantFileProtocolExtraPrivileges',
      FuseV1Options.GrantFileProtocolExtraPrivileges
    ],
    ['WasmTrapHandlers', FuseV1Options.WasmTrapHandlers]
  ]
  const configuredOptions = new Set(options.map(([, option]) => option))
  const unexpectedOptions = Object.keys(wire)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .filter((option) => !configuredOptions.has(option))
  if (unexpectedOptions.length !== 0) {
    throw new Error(
      `Electron exposes unconfigured fuse indexes: ${unexpectedOptions.join(', ')}.`
    )
  }
  const states = wire as unknown as Readonly<Record<number, number>>
  const policy = Object.fromEntries(options.map(([name, option]) => {
    const state = states[option]
    if (state !== FuseState.ENABLE && state !== FuseState.DISABLE) {
      throw new Error(
        `Electron fuse ${name} has non-final state ${String(state)}.`
      )
    }
    return [name, state === FuseState.ENABLE]
  })) as unknown as MacosFusePolicy
  assertMacosFusePolicy(policy)
  return policy
}

export async function applyMacosFusePolicy(appPath: string): Promise<void> {
  const { flipFuses, FuseVersion, FuseV1Options } = await import(
    '@electron/fuses'
  )
  await flipFuses(appPath, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: macosFusePolicy.RunAsNode,
    [FuseV1Options.EnableCookieEncryption]: (
      macosFusePolicy.EnableCookieEncryption
    ),
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: (
      macosFusePolicy.EnableNodeOptionsEnvironmentVariable
    ),
    [FuseV1Options.EnableNodeCliInspectArguments]: (
      macosFusePolicy.EnableNodeCliInspectArguments
    ),
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: (
      macosFusePolicy.EnableEmbeddedAsarIntegrityValidation
    ),
    [FuseV1Options.OnlyLoadAppFromAsar]: (
      macosFusePolicy.OnlyLoadAppFromAsar
    ),
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: (
      macosFusePolicy.LoadBrowserProcessSpecificV8Snapshot
    ),
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: (
      macosFusePolicy.GrantFileProtocolExtraPrivileges
    ),
    [FuseV1Options.WasmTrapHandlers]: macosFusePolicy.WasmTrapHandlers
  })
  await readMacosFusePolicy(appPath)
}
