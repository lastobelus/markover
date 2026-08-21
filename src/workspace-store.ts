import fs from 'node:fs/promises'
import path from 'node:path'

import { replaceJsonFile } from './atomic-json'
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
  private latestWrite: Promise<void> = Promise.resolve()
  private latestSnapshot: MarkoverWorkspaceState | null = null

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

  private enqueueWrite(snapshot: MarkoverWorkspaceState): Promise<void> {
    const write = this.writer.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await replaceJsonFile(this.filePath, snapshot)
      this.state = cloneWorkspaceState(snapshot)
    })
    this.writer = write.then(() => undefined, () => undefined)
    this.latestWrite = write
    return write
  }

  async replace(value: unknown): Promise<MarkoverWorkspaceState> {
    const snapshot = parseWorkspaceState(value)
    this.latestSnapshot = cloneWorkspaceState(snapshot)
    const write = this.enqueueWrite(snapshot)
    await write
    return cloneWorkspaceState(this.state)
  }

  async flush(): Promise<void> {
    let retry: Promise<void> | null = null
    for (;;) {
      const pending = this.latestWrite
      try {
        await pending
      } catch (error) {
        if (pending !== this.latestWrite) continue
        if (pending === retry || !this.latestSnapshot) throw error
        retry = this.enqueueWrite(this.latestSnapshot)
        continue
      }
      if (pending === this.latestWrite) return
    }
  }
}
