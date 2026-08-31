export type ActionProgress = {
  state: 'working' | 'waiting'
  summary: string
  phase?: string
  detail?: string
  current?: number
  total?: number
  unit?: string
}

export type ActionReport = {
  outcome: 'success' | 'attention' | 'blocked'
  summary: string
  reason?: string
  subject?: {
    type: string
    id: string
    revision?: string
    url?: string
  }
  facts?: Record<string, string>
  artifacts?: ReadonlyArray<{ label: string, url: string }>
}

export interface MarkoverActionReporter {
  readonly resumable: boolean
  progress(progress: ActionProgress): void
  terminal(input: {
    fallback: string
    report?: ActionReport
    stream?: 'stdout' | 'stderr'
  }): void
}

export function createMarkoverActionReporter(input: {
  label: string
  env?: Readonly<Record<string, string | undefined>>
  stdout?: (data: string) => void
  stderr?: (data: string) => void
}): MarkoverActionReporter

export function frame(
  runId: string,
  token: string,
  event: {
    kind: 'progress'
    progress: { version: 1 } & ActionProgress
  } | {
    kind: 'result'
    report: { version: 1 } & ActionReport
  }
): string

export const ACTION_PROTOCOL_VERSION: 1
export const ACTION_PROTOCOL_OSC: '777;T3ActionEvent'
export const ACTION_RUN_ID_ENV: 'T3CODE_ACTION_RUN_ID'
export const ACTION_EVENT_TOKEN_ENV: 'T3CODE_ACTION_EVENT_TOKEN'
