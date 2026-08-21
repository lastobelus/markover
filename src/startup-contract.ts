export const STARTUP_PHASES = [
  'preparing-interface',
  'loading-settings',
  'loading-brand',
  'restoring-reviews',
  'restoring-workspace',
  'publishing-service',
  'ready'
] as const

export type StartupPhase = typeof STARTUP_PHASES[number]

export type StartupFailureCategory =
  | 'interface-preparation'
  | 'settings-access'
  | 'review-storage-access'
  | 'renderer-load'
  | 'renderer-initialization'
  | 'renderer-terminated'
  | 'service-publication'
  | 'unexpected-main-error'

export interface BuildIdentity {
  version: string
  commit: string | null
  dirty: boolean
  rendererSha256: string
}

export interface StartupInfo {
  development: boolean
  diagnosticPath: string
  elementCallouts: boolean
  holdPhase: StartupPhase | null
  failPhase: StartupPhase | null
  smoke: boolean
}

export interface StartupPhaseEvent {
  phase: StartupPhase
  state: 'begin' | 'complete'
}

export interface StartupWarning {
  category:
    | 'brand-fallback'
    | 'review-skipped'
    | 'settings-recovered'
    | 'workspace-recovered'
  subject: string
}

export function isStartupWarning(value: unknown): value is StartupWarning {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const category: unknown = Reflect.get(value, 'category')
  return (
    category === 'brand-fallback' ||
    category === 'review-skipped' ||
    category === 'settings-recovered' ||
    category === 'workspace-recovered'
  ) && typeof Reflect.get(value, 'subject') === 'string'
}

export function userFacingStartupWarnings(
  warnings: readonly StartupWarning[]
): StartupWarning[] {
  return warnings.filter((warning) => warning.category !== 'brand-fallback')
}

export interface RendererInitialization {
  warnings: StartupWarning[]
}

export interface StartupReady {
  warnings: StartupWarning[]
}

export interface RendererStartupFailure {
  category: 'renderer-initialization'
  message: string
  stack: string | null
}

export interface RendererStartupFailureResult {
  diagnosticAvailable: boolean
}

export interface RendererSmokeResult {
  format: 'markover-renderer-smoke'
  version: 1
  diagnostics: string[]
  checks: {
    cleanRuntime: boolean
    blobImage: boolean
    dataImage: boolean
    documentsList: boolean
    attachmentImage: boolean
    markdown: boolean
    navigationDenied: boolean
    permissionDenied: boolean
    sandboxedRenderer: boolean
    sourceDiff: boolean
    webviewDenied: boolean
    windowOpenDenied: boolean
    yaml: boolean
  }
}

export function isStartupPhase(value: unknown): value is StartupPhase {
  return typeof value === 'string' && (
    STARTUP_PHASES as readonly string[]
  ).includes(value)
}

function controlValue(
  args: readonly string[],
  option: '--dev-hold-startup' | '--dev-fail-startup'
): StartupPhase | null {
  const prefix = `${option}=`
  const matches = args.filter((argument) => argument.startsWith(prefix))
  if (matches.length > 1) throw new Error(`${option} may be specified only once.`)
  const match = matches[0]
  if (!match) return null
  const value = match.slice(prefix.length)
  if (!isStartupPhase(value)) {
    throw new Error(`${option} requires a known startup phase.`)
  }
  return value
}

export function developmentStartupControls(
  args: readonly string[],
  development: boolean,
  smoke: boolean
): Pick<StartupInfo, 'holdPhase' | 'failPhase'> {
  if (!development || smoke) return { holdPhase: null, failPhase: null }
  return {
    holdPhase: controlValue(args, '--dev-hold-startup'),
    failPhase: controlValue(args, '--dev-fail-startup')
  }
}

export function isDevelopmentRuntime(
  packaged: boolean,
  resolvedInstanceEnvironment: string | undefined
): boolean {
  return !packaged || resolvedInstanceEnvironment !== undefined
}
