import packageJson from '../package.json'

import * as markover from '../../../scripts/markover'
import { loadRemoteProfile } from '../../../src/remote-profile'
import { ensureInstalledApp } from './bootstrap'

process.env.MARKOVER_INVOCATION ||= [
  'npx --yes',
  '--package=https://github.com/lastobelus/markover/releases/latest/download/markover-cli.tgz',
  'markover'
].join(' ')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface PublicCliMainOptions {
  ensureApp?: typeof ensureInstalledApp
  loadProfile?: typeof loadRemoteProfile
  run?: typeof markover.main
}

export async function main(
  args: string[] = process.argv.slice(2),
  {
    ensureApp = ensureInstalledApp,
    loadProfile = loadRemoteProfile,
    run = markover.main
  }: PublicCliMainOptions = {}
): Promise<void> {
  let parsed
  try {
    parsed = markover.parseCommandArguments(args)
  } catch {
    await run(args)
    return
  }
  const canUseRemoteProfile = parsed.command !== 'help' &&
    parsed.command !== 'cleanup' &&
    parsed.command !== 'canonical' &&
    parsed.instance === undefined
  let remoteProfile = null
  if (canUseRemoteProfile) {
    try {
      remoteProfile = await loadProfile()
    } catch (error) {
      process.stderr.write(`markover remote profile: ${errorMessage(error)}\n`)
      process.exitCode = 1
      return
    }
  }
  if (
    parsed.command !== 'help' &&
    parsed.command !== 'cleanup' &&
    parsed.instance !== 'development' &&
    !remoteProfile
  ) {
    try {
      process.env.MARKOVER_APP_PATH = await ensureApp({
        version: packageJson.version
      })
    } catch (error) {
      process.stderr.write(`markover bootstrap: ${errorMessage(error)}\n`)
      process.exitCode = 1
      return
    }
  }
  await run(args, canUseRemoteProfile
    ? { loadRemoteProfile: () => Promise.resolve(remoteProfile) }
    : {})
}

if (require.main === module) void main()
