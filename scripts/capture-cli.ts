import path from 'node:path'

import {
  CAPTURE_ROOT,
  CAPTURE_ROOT_MARKER,
  CAPTURE_SESSION_RECEIPT
} from './capture-media'
import { main as markoverMain } from './markover'
import { probeService } from '../src/local-client'

async function requireCaptureService(): Promise<void> {
  const endpointPath = path.join(CAPTURE_ROOT, 'service.json')
  try {
    await probeService(endpointPath)
  } catch {
    throw new Error('The capture instance is not running. Start it with npm run capture:stage.')
  }
}

async function main(args = process.argv.slice(2)): Promise<void> {
  delete process.env.CLAUDE_CODE_SESSION_ID
  delete process.env.CLAUDE_SESSION_ID
  delete process.env.CODEX_THREAD_ID
  delete process.env.T3CODE_THREAD_ID
  delete process.env.T3_THREAD_ID
  process.env.MARKOVER_INVOCATION = 'npm --silent run capture:cli --'
  await Promise.all([
    import('node:fs/promises').then(({ access }) => access(path.join(
      CAPTURE_ROOT,
      CAPTURE_ROOT_MARKER
    ))),
    import('node:fs/promises').then(({ access }) => access(path.join(
      CAPTURE_ROOT,
      CAPTURE_SESSION_RECEIPT
    )))
  ]).catch(() => {
    throw new Error('The capture fixture is missing. Prepare it with npm run capture:stage.')
  })
  await markoverMain(args, {
    endpointPath: path.join(CAPTURE_ROOT, 'service.json'),
    ensure: requireCaptureService,
    loadRemoteProfile: () => Promise.resolve(null),
    settingsPath: path.join(CAPTURE_ROOT, 'settings.json')
  })
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover capture: ${message}\n`)
    process.exitCode = 1
  })
}
