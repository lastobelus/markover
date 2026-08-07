import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_SETTINGS, normalizeSettings, updateSettings } from './settings'

interface SettingsReadResult {
  recoveredMalformedFile: boolean
  settings: MarkoverSettings
}

function errorProperty(error: unknown, key: 'code' | 'name'): unknown {
  return error !== null && typeof error === 'object' ? Reflect.get(error, key) : null
}

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds)
})

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorProperty(error, 'code') !== 'ESRCH'
  }
}

async function releaseOwnedLock(lockPath: string, owner: string): Promise<void> {
  const currentOwner = await fs.readlink(lockPath).catch(() => null)
  if (currentOwner === owner) await fs.unlink(lockPath).catch(() => {})
}

export class SettingsStore {
  readonly filePath: string
  lastRecoveryWarning: string | null
  settings: MarkoverSettings
  private readonly initialSettings: MarkoverSettings
  private writer: Promise<unknown>
  private writeSequence: number
  private watcher: FSWatcher | null

  constructor(filePath: string, initialSettings: unknown = DEFAULT_SETTINGS) {
    this.filePath = filePath
    this.lastRecoveryWarning = null
    this.initialSettings = normalizeSettings(initialSettings)
    this.settings = { ...this.initialSettings }
    this.writer = Promise.resolve()
    this.writeSequence = 0
    this.watcher = null
  }

  private async readResult(): Promise<SettingsReadResult> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      return {
        recoveredMalformedFile: false,
        settings: normalizeSettings(parsed)
      }
    } catch (error) {
      if (errorProperty(error, 'code') === 'ENOENT') {
        return {
          recoveredMalformedFile: false,
          settings: { ...this.initialSettings }
        }
      }
      if (errorProperty(error, 'name') === 'SyntaxError') {
        return {
          recoveredMalformedFile: true,
          settings: { ...this.initialSettings }
        }
      }
      throw error
    }
  }

  async read(): Promise<MarkoverSettings> {
    return (await this.readResult()).settings
  }

  async load(): Promise<MarkoverSettings> {
    const result = await this.readResult()
    this.settings = result.settings
    this.lastRecoveryWarning = result.recoveredMalformedFile
      ? 'The settings file is malformed; defaults were used and the file was preserved.'
      : null
    return { ...this.settings }
  }

  async update(patch: unknown): Promise<MarkoverSettings> {
    const sequence = ++this.writeSequence
    const write = this.writer.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const lockPath = `${this.filePath}.lock`
      const owner = `${String(process.pid)}:${randomUUID()}`
      let ownsLock = false
      for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
          await fs.symlink(owner, lockPath)
          ownsLock = true
          break
        } catch (error) {
          if (errorProperty(error, 'code') !== 'EEXIST') throw error
          const observedOwner = await fs.readlink(lockPath).catch(() => '')
          const ownerPid = Number.parseInt(observedOwner.split(':')[0] ?? '', 10)
          if (Number.isInteger(ownerPid) && !processIsRunning(ownerPid)) {
            await releaseOwnedLock(lockPath, observedOwner)
          }
          await wait(10)
        }
      }
      if (!ownsLock) throw new Error('Timed out waiting to update Markover settings.')

      const temporaryPath = `${this.filePath}.${String(process.pid)}.${String(sequence)}.tmp`
      try {
        const snapshot = updateSettings(await this.read(), patch)
        await fs.writeFile(
          temporaryPath,
          `${JSON.stringify(snapshot, null, 2)}\n`,
          'utf8'
        )
        await fs.rename(temporaryPath, this.filePath)
        this.settings = snapshot
        return { ...snapshot }
      } finally {
        await fs.unlink(temporaryPath).catch((error: unknown) => {
          if (errorProperty(error, 'code') !== 'ENOENT') throw error
        })
        await releaseOwnedLock(lockPath, owner)
      }
    })
    this.writer = write.then(() => undefined, () => undefined)
    return write
  }

  async subscribe(
    listener: (settings: MarkoverSettings) => void
  ): Promise<() => void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const refresh = async () => {
      try {
        const settings = await this.read()
        if (JSON.stringify(settings) === JSON.stringify(this.settings)) return
        this.settings = settings
        listener({ ...settings })
      } catch {
        // Ignore transient reads; the next file-system event retries refresh.
      }
    }
    this.watcher = watch(
      path.dirname(this.filePath),
      { persistent: false },
      (_event, filename) => {
        if (String(filename) !== path.basename(this.filePath)) return
        if (refreshTimer !== null) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          void refresh()
        }, 25)
      }
    )
    await refresh()
    return () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      this.watcher?.close()
      this.watcher = null
    }
  }
}
