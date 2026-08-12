import fs from 'node:fs/promises'
import path from 'node:path'

import {
  cloneWorkspaceState,
  defaultWorkspaceState,
  parseWorkspaceState
} from './workspace-state'

function errorProperty(error: unknown, key: 'code' | 'name'): unknown {
  return error !== null && typeof error === 'object' ? Reflect.get(error, key) : null
}

interface WorkspaceReadResult {
  recoveredInvalidFile: boolean
  state: MarkoverWorkspaceState
}

export class WorkspaceStore {
  readonly filePath: string
  lastRecoveryWarning: string | null = null
  state: MarkoverWorkspaceState = defaultWorkspaceState()
  private writer: Promise<void> = Promise.resolve()
  private writeSequence = 0

  constructor(filePath: string) {
    this.filePath = filePath
  }

  private async readResult(): Promise<WorkspaceReadResult> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      return {
        recoveredInvalidFile: false,
        state: parseWorkspaceState(parsed)
      }
    } catch (error) {
      if (errorProperty(error, 'code') === 'ENOENT') {
        return {
          recoveredInvalidFile: false,
          state: defaultWorkspaceState()
        }
      }
      if (
        errorProperty(error, 'name') === 'SyntaxError' ||
        (error instanceof Error && error.message.includes('private format'))
      ) {
        return {
          recoveredInvalidFile: true,
          state: defaultWorkspaceState()
        }
      }
      throw error
    }
  }

  async load(): Promise<MarkoverWorkspaceState> {
    const result = await this.readResult()
    this.state = result.state
    this.lastRecoveryWarning = result.recoveredInvalidFile
      ? 'The private workspace file is malformed or incompatible; default view state was used and reviews were left untouched.'
      : null
    return cloneWorkspaceState(this.state)
  }

  async replace(value: unknown): Promise<MarkoverWorkspaceState> {
    const snapshot = parseWorkspaceState(value)
    const sequence = ++this.writeSequence
    const write = this.writer.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.${String(process.pid)}.${String(sequence)}.tmp`
      try {
        await fs.writeFile(
          temporaryPath,
          `${JSON.stringify(snapshot, null, 2)}\n`,
          { encoding: 'utf8', mode: 0o600 }
        )
        await fs.rename(temporaryPath, this.filePath)
        this.state = cloneWorkspaceState(snapshot)
      } finally {
        await fs.unlink(temporaryPath).catch((error: unknown) => {
          if (errorProperty(error, 'code') !== 'ENOENT') throw error
        })
      }
    })
    this.writer = write.then(() => undefined, () => undefined)
    await write
    return cloneWorkspaceState(this.state)
  }

  async flush(): Promise<void> {
    for (;;) {
      const pending = this.writer
      await pending
      if (pending === this.writer) return
    }
  }
}
