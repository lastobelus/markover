import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents
} from 'electron'

import {
  assertRendererInvokeArguments,
  assertRendererSendArguments,
  IpcContractError,
  type RendererInvokeArguments,
  type RendererInvokeChannel,
  type RendererSendArguments,
  type RendererSendChannel
} from './ipc-contract'

export interface RendererIpcEntry {
  query: Readonly<Record<string, string>>
  url: string
}

export interface PrivilegedIpcOptions {
  activeWebContents: () => WebContents | null
  diagnose: (
    channel: RendererInvokeChannel | RendererSendChannel,
    reason: IpcRejectionReason
  ) => void
  expectedEntry: () => RendererIpcEntry | null
}

export type IpcRejectionReason =
  | 'inactive-sender'
  | 'non-main-frame'
  | 'unexpected-url'
  | 'invalid-payload'

class IpcSenderError extends Error {
  readonly reason: Exclude<IpcRejectionReason, 'invalid-payload'>

  constructor(reason: Exclude<IpcRejectionReason, 'invalid-payload'>) {
    super(reason)
    this.name = 'IpcSenderError'
    this.reason = reason
  }
}

function exactQuery(
  parameters: URLSearchParams,
  expected: Readonly<Record<string, string>>
): boolean {
  const expectedKeys = Object.keys(expected).sort()
  const actualKeys = [...new Set(parameters.keys())].sort()
  if (actualKeys.join('\0') !== expectedKeys.join('\0')) return false
  return expectedKeys.every((key) => {
    const values = parameters.getAll(key)
    return values.length === 1 && values[0] === expected[key]
  })
}

export function isExpectedRendererEntryUrl(
  value: string,
  expected: RendererIpcEntry
): boolean {
  try {
    const actual = new URL(value)
    const canonical = new URL(expected.url)
    return actual.protocol === canonical.protocol &&
      actual.username === canonical.username &&
      actual.password === canonical.password &&
      actual.host === canonical.host &&
      actual.pathname === canonical.pathname &&
      actual.hash === '' &&
      exactQuery(actual.searchParams, expected.query)
  } catch {
    return false
  }
}

function rejectionReason(error: unknown): IpcRejectionReason {
  if (error instanceof IpcSenderError) return error.reason
  if (error instanceof IpcContractError) return 'invalid-payload'
  return 'invalid-payload'
}

export class PrivilegedIpc {
  private readonly ipcMain: IpcMain
  private readonly options: PrivilegedIpcOptions

  constructor(ipcMain: IpcMain, options: PrivilegedIpcOptions) {
    this.ipcMain = ipcMain
    this.options = options
  }

  handle<C extends RendererInvokeChannel, TResult>(
    channel: C,
    handler: (
      event: IpcMainInvokeEvent,
      ...args: RendererInvokeArguments[C]
    ) => TResult | Promise<TResult>
  ): void {
    this.ipcMain.handle(channel, (event, ...args) => {
      try {
        this.assertSender(event)
        assertRendererInvokeArguments(channel, args)
      } catch (error) {
        this.options.diagnose(channel, rejectionReason(error))
        throw new Error(`Rejected privileged IPC request for ${channel}.`, {
          cause: error
        })
      }
      return handler(event, ...args as unknown as RendererInvokeArguments[C])
    })
  }

  on<C extends RendererSendChannel>(
    channel: C,
    listener: (
      event: IpcMainEvent,
      ...args: RendererSendArguments[C]
    ) => void
  ): void {
    this.ipcMain.on(channel, (event, ...args) => {
      try {
        this.assertSender(event)
        assertRendererSendArguments(channel, args)
      } catch (error) {
        this.options.diagnose(channel, rejectionReason(error))
        return
      }
      listener(event, ...args as unknown as RendererSendArguments[C])
    })
  }

  private assertSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
    const active = this.options.activeWebContents()
    if (
      !active ||
      active.isDestroyed() ||
      event.sender !== active
    ) {
      throw new IpcSenderError('inactive-sender')
    }

    const frame = event.senderFrame
    if (!frame || frame !== active.mainFrame) {
      throw new IpcSenderError('non-main-frame')
    }

    const expected = this.options.expectedEntry()
    if (!expected || !isExpectedRendererEntryUrl(frame.url, expected)) {
      throw new IpcSenderError('unexpected-url')
    }
  }
}
