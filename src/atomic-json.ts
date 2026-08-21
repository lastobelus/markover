import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface AtomicJsonReplacementOptions {
  platform?: NodeJS.Platform
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : null
}

export async function replaceJsonFile(
  filePath: string,
  value: unknown,
  { platform = process.platform }: AtomicJsonReplacementOptions = {}
): Promise<void> {
  const contents = `${JSON.stringify(value, null, 2)}\n`
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`
  )

  try {
    await fs.writeFile(temporaryPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true,
      mode: 0o600
    })
    if (platform !== 'win32') await fs.chmod(temporaryPath, 0o600)
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.unlink(temporaryPath).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') throw error
    })
  }
}
