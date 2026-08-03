import packageJson from '../package.json'

import * as markover from '../../../scripts/markover'
import { ensureInstalledApp } from './bootstrap'

process.env.MARKOVER_INVOCATION ||= [
  'npx --yes',
  '--package=https://github.com/lastobelus/markover/releases/latest/download/markover-cli.tgz',
  'markover'
].join(' ')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  let parsed
  try {
    parsed = markover.parseCommandArguments(args)
  } catch {
    await markover.main(args)
    return
  }
  if (parsed.command !== 'help') {
    try {
      process.env.MARKOVER_APP_PATH = await ensureInstalledApp({
        version: packageJson.version
      })
    } catch (error) {
      process.stderr.write(`markover bootstrap: ${errorMessage(error)}\n`)
      process.exitCode = 1
      return
    }
  }
  await markover.main(args)
}

if (require.main === module) void main()
