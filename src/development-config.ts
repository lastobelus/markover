import fs from 'node:fs/promises'
import path from 'node:path'

import { normalizeSettings } from './settings'

export const DEVELOPMENT_CONFIG_RELATIVE_PATH = path.join(
  '.markover',
  'development.json'
)

export interface DevelopmentConfig {
  version: 1
  settings: MarkoverSettings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function developmentConfigPath(checkout: string): string {
  return path.join(path.resolve(checkout), DEVELOPMENT_CONFIG_RELATIVE_PATH)
}

export function parseDevelopmentConfig(value: unknown): DevelopmentConfig {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.settings)) {
    throw new Error(
      'Development configuration must use version 1 and contain a settings object.'
    )
  }
  return {
    version: 1,
    settings: normalizeSettings(value.settings)
  }
}

export async function loadDevelopmentConfig(
  checkout: string
): Promise<DevelopmentConfig> {
  const filePath = developmentConfigPath(checkout)
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    const code: unknown = error !== null && typeof error === 'object'
      ? Reflect.get(error, 'code')
      : null
    if (code === 'ENOENT') {
      throw new Error(
        `Development configuration is missing: ${filePath}. Run scripts/setup-worktree.sh.`,
        { cause: error }
      )
    }
    throw new Error(`Development configuration is invalid: ${filePath}.`, {
      cause: error
    })
  }
  return parseDevelopmentConfig(parsed)
}
