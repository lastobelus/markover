import fs from 'node:fs/promises'
import path from 'node:path'

import { replaceJsonFile } from './atomic-json'
import { DEFAULT_SETTINGS, normalizeSettings, updateSettings } from './settings'

interface SettingsReadResult {
  recoveredMalformedFile: boolean
  settings: MarkoverSettings
}

function errorProperty(error: unknown, key: 'code' | 'name'): unknown {
  return error !== null && typeof error === 'object' ? Reflect.get(error, key) : null
}

export class SettingsStore {
  readonly filePath: string
  lastRecoveryWarning: string | null
  settings: MarkoverSettings
  private readonly initialSettings: MarkoverSettings
  private writer: Promise<unknown>

  constructor(filePath: string, initialSettings: unknown = DEFAULT_SETTINGS) {
    this.filePath = filePath
    this.lastRecoveryWarning = null
    this.initialSettings = normalizeSettings(initialSettings)
    this.settings = { ...this.initialSettings }
    this.writer = Promise.resolve()
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
    const write = this.writer.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const snapshot = updateSettings(this.settings, patch)
      await replaceJsonFile(this.filePath, snapshot)
      this.settings = snapshot
      return { ...snapshot }
    })
    this.writer = write.then(() => undefined, () => undefined)
    return write
  }
}
