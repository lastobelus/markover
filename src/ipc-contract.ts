import type {
  RendererInitialization,
  RendererSmokeResult,
  RendererStartupFailure,
  RendererStartupFailureResult,
  StartupInfo,
  StartupPhase,
  StartupPhaseEvent,
  StartupReady,
  StartupWarning
} from './startup-contract'

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const ATTACHMENT_ID_PATTERN = /^img-[1-9]\d*$/
const REQUEST_ID_PATTERN = /^(?:activation|snapshot|status)-[1-9]\d*$/
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/

const REVIEW_NODE_TYPES = new Set<ReviewNodeType>([
  'document',
  'heading',
  'paragraph',
  'blockquote',
  'table',
  'thematic-break',
  'ordered-item',
  'unordered-item',
  'code',
  'frontmatter',
  'frontmatter-entry'
])

const SETTINGS_KEYS = [
  'palette',
  'appearance',
  'treeDensity',
  'annotationTextSize',
  'showKeyboardHelp',
  'openDocumentsSidebar',
  'defaultTreeView',
  'confirmAttachmentRemoval',
  'incomingReviewActivationPolicy',
  'incomingReviewIdleMinutes',
  'discoverAgentThreadFromLocalSessions',
  'logRejectedApiRequests',
  'agentInterpretationPolicy',
  'autosaveMaximumDelayMs'
] as const

export interface ReviewContextMenuRequest {
  reviewId: string
}

export interface AttachmentRemoveRequest {
  reviewId: string
  attachmentId: string
  tree: ReviewTree
}

export interface AttachmentRemoveResult {
  reviewId: string
  attachmentId: string
  outcome: 'cancelled' | 'trashed'
}

export interface ReviewTrashedEvent {
  reviewId: string
}

export interface RendererInvokeArguments {
  'startup:info': []
  'startup:phase': [StartupPhaseEvent]
  'startup:renderer-initialized': [RendererInitialization]
  'startup:failure': [RendererStartupFailure]
  'startup:copy-diagnostic': []
  'startup:reveal-diagnostic': []
  'smoke:result': [RendererSmokeResult]
  'document:open': []
  'brand:assets': []
  'document:checksum': [string]
  'attachment:save': [MarkoverClipboardImage, string | null | undefined]
  'clipboard:read-image': []
  'review:autosave-status:get': []
  'settings:get': []
  'settings:update': [unknown]
  'window:focus-state:get': []
  'review:initial-document': []
  'review:list': []
  'review:context-menu:open': [ReviewContextMenuRequest]
  'attachment:remove': [AttachmentRemoveRequest]
}

export interface RendererInvokeResults {
  'startup:info': StartupInfo
  'startup:phase': undefined
  'startup:renderer-initialized': StartupReady
  'startup:failure': RendererStartupFailureResult
  'startup:copy-diagnostic': undefined
  'startup:reveal-diagnostic': undefined
  'smoke:result': undefined
  'document:open': MarkoverDocument | null
  'brand:assets': MarkoverBrandAssets
  'document:checksum': string
  'attachment:save': ReviewAttachment
  'clipboard:read-image': MarkoverClipboardImage | null
  'review:autosave-status:get': ReviewAutosaveStatus
  'settings:get': MarkoverSettingsEnvelope
  'settings:update': MarkoverSettingsEnvelope
  'window:focus-state:get': MarkoverWindowFocusState
  'review:initial-document': MarkoverDocument | null
  'review:list': MarkoverDocument[]
  'review:context-menu:open': undefined
  'attachment:remove': AttachmentRemoveResult
}

export interface RendererSendArguments {
  'startup:quit': []
  'review:snapshot-response': [ReviewSnapshotResponse]
  'review:status-response': [ReviewStatusResponse]
  'review:activation-response': [ReviewActivationResponse]
  'clipboard:write': [string]
  'review:activate': [string]
  'review:autosave': [string | null, ReviewTree]
  'review:done': [ReviewTree]
  'review:cancel': []
}

export interface MainEventArguments {
  'document:open-request': []
  'settings:open': []
  'settings:changed': [MarkoverSettingsEnvelope]
  'window:focus-state': [MarkoverWindowFocusState]
  'review:opened': [MarkoverDocument]
  'review:status': [ReviewStatusRequest]
  'review:snapshot-request': [ReviewSnapshotRequest]
  'review:autosave-status': [ReviewAutosaveStatus]
  'review:shutdown-state': [boolean]
  'review:activation-request': [ReviewActivationRequest]
  'review:trashed': [ReviewTrashedEvent]
}

export type RendererInvokeChannel = keyof RendererInvokeArguments
export type RendererSendChannel = keyof RendererSendArguments
export type MainEventChannel = keyof MainEventArguments

export class IpcContractError extends Error {
  readonly channel: string

  constructor(channel: string, direction: string) {
    super(`Invalid ${direction} IPC contract for ${channel}.`)
    this.name = 'IpcContractError'
    this.channel = channel
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isReviewId(value: unknown): value is string {
  return typeof value === 'string' && REVIEW_ID_PATTERN.test(value)
}

function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && ATTACHMENT_ID_PATTERN.test(value)
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
}

function isChecksum(value: unknown): value is string {
  return typeof value === 'string' && CHECKSUM_PATTERN.test(value)
}

function isSourceEdit(value: unknown): value is SourceEdit {
  return hasExactKeys(value, ['original', 'current']) &&
    typeof value.original === 'string' &&
    typeof value.current === 'string'
}

function isReviewAttachment(value: unknown): value is ReviewAttachment {
  if (!hasExactKeys(value, ['id'], [
    'type',
    'label',
    'path',
    'mimeType',
    'url',
    'checksum',
    'width',
    'height'
  ])) return false
  return isAttachmentId(value.id) &&
    (value.type === undefined || value.type === 'image') &&
    isOptionalString(value.label) &&
    isOptionalString(value.path) &&
    isOptionalString(value.mimeType) &&
    isOptionalString(value.url) &&
    (value.checksum === undefined || isChecksum(value.checksum)) &&
    (
      value.width === undefined ||
      value.width === null ||
      isPositiveInteger(value.width)
    ) &&
    (
      value.height === undefined ||
      value.height === null ||
      isPositiveInteger(value.height)
    )
}

function isReviewNode(value: unknown): value is ReviewNode {
  if (!isRecord(value) || !REVIEW_NODE_TYPES.has(value.type as ReviewNodeType)) {
    return false
  }
  const required = [
    'id',
    'raw',
    'type',
    'text',
    'lineStart',
    'lineEnd',
    'feedback',
    'collapsed',
    'children'
  ]
  const optional = ['sourceEdit', 'sourceEditable', 'attachments']
  if (value.type === 'heading') required.push('level')
  if (value.type === 'code') required.push('language')
  if (value.type === 'frontmatter-entry') required.push('key')
  if (value.type === 'ordered-item' || value.type === 'unordered-item') {
    required.push('marker', 'listId', 'listPosition', 'listLength')
    optional.push('task', 'checked')
  }
  if (!hasExactKeys(value, required, optional)) return false
  if (
    typeof value.id !== 'string' || !value.id ||
    typeof value.raw !== 'string' ||
    typeof value.text !== 'string' ||
    !isPositiveInteger(value.lineStart) ||
    !isPositiveInteger(value.lineEnd) ||
    value.lineEnd < value.lineStart ||
    typeof value.feedback !== 'string' ||
    typeof value.collapsed !== 'boolean' ||
    !Array.isArray(value.children) ||
    !value.children.every(isReviewNode) ||
    (value.sourceEdit !== undefined && !isSourceEdit(value.sourceEdit)) ||
    (value.sourceEditable !== undefined && typeof value.sourceEditable !== 'boolean') ||
    (
      value.attachments !== undefined &&
      (!Array.isArray(value.attachments) || !value.attachments.every(isReviewAttachment))
    )
  ) return false

  if (value.type === 'heading') {
    return isPositiveInteger(value.level) && value.level <= 6
  }
  if (value.type === 'code') return typeof value.language === 'string'
  if (value.type === 'frontmatter-entry') return typeof value.key === 'string'
  if (value.type === 'frontmatter' && value.sourceEditable !== false) return false
  if (value.type === 'ordered-item' || value.type === 'unordered-item') {
    return typeof value.marker === 'string' &&
      typeof value.listId === 'string' &&
      isPositiveInteger(value.listPosition) &&
      (
        value.listLength === null ||
        (
          isPositiveInteger(value.listLength) &&
          value.listPosition <= value.listLength
        )
      ) &&
      (value.task === undefined || value.task === true) &&
      (value.checked === undefined || typeof value.checked === 'boolean')
  }
  return true
}

function isAgentGuidance(value: unknown): value is AgentGuidance {
  return hasExactKeys(value, ['fixedContract', 'interpretationPolicy']) &&
    typeof value.fixedContract === 'string' &&
    typeof value.interpretationPolicy === 'string'
}

function isReviewEnvelope(value: unknown): boolean {
  if (!hasExactKeys(value, ['id', 'status'], [
    'createdAt',
    'updatedAt',
    'contextSummary',
    'agentThread',
    'git',
    'pullRequest',
    'agentGuidance'
  ])) return false
  return isReviewId(value.id) &&
    (
      value.status === 'editing' ||
      value.status === 'pending-agent' ||
      value.status === 'handoff-in-progress'
    ) &&
    isOptionalString(value.createdAt) &&
    isOptionalString(value.updatedAt) &&
    isOptionalString(value.contextSummary) &&
    (value.agentGuidance === undefined || isAgentGuidance(value.agentGuidance))
}

export function isReviewTree(value: unknown): value is ReviewTree {
  if (!hasExactKeys(
    value,
    ['format', 'version', 'sourceDocument', 'unsupported', 'root'],
    ['review']
  )) return false
  if (
    value.format !== 'markover-review' ||
    value.version !== 1 ||
    !hasExactKeys(value.sourceDocument, ['name', 'path', 'content', 'checksum']) ||
    !isStringOrNull(value.sourceDocument.name) ||
    !isStringOrNull(value.sourceDocument.path) ||
    typeof value.sourceDocument.content !== 'string' ||
    !isChecksum(value.sourceDocument.checksum) ||
    !Array.isArray(value.unsupported) ||
    !value.unsupported.every((line) => (
      hasExactKeys(line, ['line', 'text']) &&
      isPositiveInteger(line.line) &&
      typeof line.text === 'string'
    )) ||
    !isReviewNode(value.root) ||
    value.root.type !== 'document'
  ) return false
  return value.review === undefined || isReviewEnvelope(value.review)
}

function isClipboardImage(value: unknown): value is MarkoverClipboardImage {
  return hasExactKeys(value, ['bytes', 'mimeType']) &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength > 0 &&
    (value.mimeType === 'image/png' || value.mimeType === 'image/jpeg')
}

function isDocument(value: unknown): value is MarkoverDocument {
  if (!hasExactKeys(value, ['name', 'path', 'source', 'checksum'], [
    'reviewId',
    'projectRoot',
    'tree',
    'durable',
    'autosavePath'
  ])) return false
  if (
    !isStringOrNull(value.name) ||
    !isStringOrNull(value.path) ||
    typeof value.source !== 'string' ||
    !isChecksum(value.checksum) ||
    (value.reviewId !== undefined && !isReviewId(value.reviewId)) ||
    (
      value.projectRoot !== undefined &&
      !isStringOrNull(value.projectRoot)
    ) ||
    (value.tree !== undefined && !isReviewTree(value.tree)) ||
    (value.durable !== undefined && typeof value.durable !== 'boolean') ||
    (
      value.autosavePath !== undefined &&
      !isStringOrNull(value.autosavePath)
    )
  ) return false
  if (value.tree && (
    value.tree.sourceDocument.content !== value.source ||
    value.tree.sourceDocument.checksum !== value.checksum
  )) return false
  if (
    value.reviewId &&
    isRecord(value.tree?.review) &&
    value.tree.review.id !== value.reviewId
  ) return false
  return true
}

function isStartupWarningValue(value: unknown): value is StartupWarning {
  return hasExactKeys(value, ['category', 'subject']) &&
    (
      value.category === 'brand-fallback' ||
      value.category === 'review-skipped' ||
      value.category === 'settings-recovered'
    ) &&
    typeof value.subject === 'string'
}

function isStartupInfo(value: unknown): value is StartupInfo {
  return hasExactKeys(value, [
    'development',
    'diagnosticPath',
    'holdPhase',
    'failPhase',
    'smoke'
  ]) &&
    typeof value.development === 'boolean' &&
    typeof value.diagnosticPath === 'string' &&
    (value.holdPhase === null || isStartupPhaseValue(value.holdPhase)) &&
    (value.failPhase === null || isStartupPhaseValue(value.failPhase)) &&
    typeof value.smoke === 'boolean'
}

function isStartupPhaseValue(value: unknown): value is StartupPhase {
  return value === 'preparing-interface' ||
    value === 'loading-settings' ||
    value === 'loading-brand' ||
    value === 'restoring-reviews' ||
    value === 'restoring-workspace' ||
    value === 'publishing-service' ||
    value === 'ready'
}

function isStartupPhaseEvent(value: unknown): value is StartupPhaseEvent {
  return hasExactKeys(value, ['phase', 'state']) &&
    isStartupPhaseValue(value.phase) &&
    (value.state === 'begin' || value.state === 'complete')
}

function isRendererInitialization(value: unknown): value is RendererInitialization {
  return hasExactKeys(value, ['warnings']) &&
    Array.isArray(value.warnings) &&
    value.warnings.every(isStartupWarningValue)
}

function isRendererStartupFailure(value: unknown): value is RendererStartupFailure {
  return hasExactKeys(value, ['category', 'message', 'stack']) &&
    value.category === 'renderer-initialization' &&
    typeof value.message === 'string' &&
    isStringOrNull(value.stack)
}

function isStartupReady(value: unknown): value is StartupReady {
  return hasExactKeys(value, ['warnings']) &&
    Array.isArray(value.warnings) &&
    value.warnings.every(isStartupWarningValue)
}

function isRendererSmokeResult(value: unknown): value is RendererSmokeResult {
  const checkKeys = [
    'cleanRuntime',
    'blobImage',
    'dataImage',
    'documentsList',
    'fileImage',
    'markdown',
    'navigationDenied',
    'permissionDenied',
    'sandboxedRenderer',
    'sourceDiff',
    'webviewDenied',
    'windowOpenDenied',
    'yaml'
  ]
  if (!hasExactKeys(value, [
    'format',
    'version',
    'diagnostics',
    'checks'
  ])) return false
  const checks = value.checks
  return (
    value.format === 'markover-renderer-smoke' &&
    value.version === 1 &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every((item) => typeof item === 'string') &&
    hasExactKeys(checks, checkKeys) &&
    checkKeys.every((key) => typeof checks[key] === 'boolean')
  )
}

function settingsValueValid(key: string, value: unknown): boolean {
  switch (key) {
    case 'palette': return value === 'ember' || value === 'ocean' || value === 'olive'
    case 'appearance': return value === 'system' || value === 'light' || value === 'dark'
    case 'treeDensity': return value === 'comfortable' || value === 'compact'
    case 'annotationTextSize': return value === 'small' || value === 'medium' || value === 'large'
    case 'defaultTreeView': return value === 'all' || value === 'annotated'
    case 'incomingReviewActivationPolicy':
      return value === 'never' ||
        value === 'always' ||
        value === 'warn' ||
        value === 'when-idle'
    case 'showKeyboardHelp':
    case 'openDocumentsSidebar':
    case 'confirmAttachmentRemoval':
    case 'discoverAgentThreadFromLocalSessions':
    case 'logRejectedApiRequests':
      return typeof value === 'boolean'
    case 'agentInterpretationPolicy': return typeof value === 'string'
    case 'autosaveMaximumDelayMs':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 60_000
    case 'incomingReviewIdleMinutes':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 60
    default: return false
  }
}

function isSettingsPatch(value: unknown): boolean {
  return isRecord(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => (
      (SETTINGS_KEYS as readonly string[]).includes(key) &&
      settingsValueValid(key, value[key])
    ))
}

function isSettingsEnvelope(value: unknown): value is MarkoverSettingsEnvelope {
  return hasExactKeys(value, [...SETTINGS_KEYS, 'resolvedAppearance']) &&
    SETTINGS_KEYS.every((key) => settingsValueValid(key, value[key])) &&
    (value.resolvedAppearance === 'light' || value.resolvedAppearance === 'dark')
}

function isWindowFocusState(value: unknown): value is MarkoverWindowFocusState {
  if (!hasExactKeys(value, ['focused', 'blurredAt'])) return false
  if (typeof value.focused !== 'boolean') return false
  if (value.focused) return value.blurredAt === null
  return value.blurredAt === null || isPositiveInteger(value.blurredAt)
}

function isReviewStatusRequest(value: unknown): value is ReviewStatusRequest {
  return hasExactKeys(value, ['requestId', 'reviewId', 'status']) &&
    isRequestId(value.requestId) &&
    isReviewId(value.reviewId) &&
    (
      value.status === 'editing' ||
      value.status === 'pending-agent' ||
      value.status === 'handoff-in-progress'
    )
}

function isReviewStatusResponse(value: unknown): value is ReviewStatusResponse {
  return hasExactKeys(value, ['requestId'], ['error']) &&
    isRequestId(value.requestId) &&
    isOptionalString(value.error)
}

function isReviewSnapshotRequest(value: unknown): value is ReviewSnapshotRequest {
  return hasExactKeys(value, ['requestId', 'reviewId', 'purpose']) &&
    isRequestId(value.requestId) &&
    isReviewId(value.reviewId) &&
    (value.purpose === 'handoff' || value.purpose === 'shutdown')
}

function isReviewSnapshotResponse(value: unknown): value is ReviewSnapshotResponse {
  if (!hasExactKeys(
    value,
    ['requestId', 'reviewId', 'purpose'],
    ['tree', 'error']
  ) ||
    !isRequestId(value.requestId) ||
    !isReviewId(value.reviewId) ||
    (value.purpose !== 'handoff' && value.purpose !== 'shutdown')
  ) return false
  const hasTree = Object.hasOwn(value, 'tree')
  const hasError = Object.hasOwn(value, 'error')
  return hasTree !== hasError && (
    hasTree
      ? value.tree === null || isReviewTree(value.tree)
      : typeof value.error === 'string'
  )
}

function isReviewAutosaveStatus(value: unknown): value is ReviewAutosaveStatus {
  return hasExactKeys(value, ['failedReviewIds']) &&
    Array.isArray(value.failedReviewIds) &&
    value.failedReviewIds.every(isReviewId)
}

function isActivationOutcome(value: unknown): value is ReviewActivationOutcome {
  return value === 'activated' ||
    value === 'already-active' ||
    value === 'blocked' ||
    value === 'missing'
}

function isActivationRequest(value: unknown): value is ReviewActivationRequest {
  return hasExactKeys(value, ['requestId', 'reviewId', 'document']) &&
    isRequestId(value.requestId) &&
    isReviewId(value.reviewId) &&
    (value.document === null || isDocument(value.document)) &&
    (
      value.document === null ||
      value.document.reviewId === value.reviewId
    )
}

function isActivationResponse(value: unknown): value is ReviewActivationResponse {
  if (!hasExactKeys(
    value,
    ['requestId', 'reviewId'],
    ['outcome', 'error']
  )) return false
  const hasOutcome = Object.hasOwn(value, 'outcome')
  const hasError = Object.hasOwn(value, 'error')
  return isRequestId(value.requestId) &&
    isReviewId(value.reviewId) &&
    hasOutcome !== hasError &&
    (
      hasOutcome
        ? isActivationOutcome(value.outcome)
        : typeof value.error === 'string'
    )
}

function isContextMenuRequest(value: unknown): value is ReviewContextMenuRequest {
  return hasExactKeys(value, ['reviewId']) && isReviewId(value.reviewId)
}

function isAttachmentRemoveRequest(value: unknown): value is AttachmentRemoveRequest {
  return hasExactKeys(value, ['reviewId', 'attachmentId', 'tree']) &&
    isReviewId(value.reviewId) &&
    isAttachmentId(value.attachmentId) &&
    isReviewTree(value.tree) &&
    (
      !isRecord(value.tree.review) ||
      value.tree.review.id === value.reviewId
    )
}

function isAttachmentRemoveResult(value: unknown): value is AttachmentRemoveResult {
  return hasExactKeys(value, ['reviewId', 'attachmentId', 'outcome']) &&
    isReviewId(value.reviewId) &&
    isAttachmentId(value.attachmentId) &&
    (value.outcome === 'cancelled' || value.outcome === 'trashed')
}

function isReviewTrashedEvent(value: unknown): value is ReviewTrashedEvent {
  return hasExactKeys(value, ['reviewId']) && isReviewId(value.reviewId)
}

function singleArgument(args: readonly unknown[], predicate: (value: unknown) => boolean): boolean {
  return args.length === 1 && predicate(args[0])
}

function noArguments(args: readonly unknown[]): boolean {
  return args.length === 0
}

export function assertRendererInvokeArguments(
  channel: RendererInvokeChannel,
  args: readonly unknown[]
): void {
  let valid = false
  switch (channel) {
    case 'startup:info':
    case 'startup:copy-diagnostic':
    case 'startup:reveal-diagnostic':
    case 'document:open':
    case 'brand:assets':
    case 'clipboard:read-image':
    case 'review:autosave-status:get':
    case 'settings:get':
    case 'window:focus-state:get':
    case 'review:initial-document':
    case 'review:list':
      valid = noArguments(args)
      break
    case 'startup:phase': valid = singleArgument(args, isStartupPhaseEvent); break
    case 'startup:renderer-initialized':
      valid = singleArgument(args, isRendererInitialization)
      break
    case 'startup:failure': valid = singleArgument(args, isRendererStartupFailure); break
    case 'smoke:result': valid = singleArgument(args, isRendererSmokeResult); break
    case 'document:checksum':
      valid = singleArgument(args, (value) => typeof value === 'string')
      break
    case 'attachment:save':
      valid = args.length === 2 &&
        isClipboardImage(args[0]) &&
        (
          args[1] === undefined ||
          args[1] === null ||
          isReviewId(args[1])
        )
      break
    case 'settings:update': valid = singleArgument(args, isSettingsPatch); break
    case 'review:context-menu:open':
      valid = singleArgument(args, isContextMenuRequest)
      break
    case 'attachment:remove':
      valid = singleArgument(args, isAttachmentRemoveRequest)
      break
  }
  if (!valid) throw new IpcContractError(channel, 'renderer-to-main invoke')
}

export function assertRendererSendArguments(
  channel: RendererSendChannel,
  args: readonly unknown[]
): void {
  let valid = false
  switch (channel) {
    case 'startup:quit':
    case 'review:cancel':
      valid = noArguments(args)
      break
    case 'review:snapshot-response':
      valid = singleArgument(args, isReviewSnapshotResponse)
      break
    case 'review:status-response':
      valid = singleArgument(args, isReviewStatusResponse)
      break
    case 'review:activation-response':
      valid = singleArgument(args, isActivationResponse)
      break
    case 'clipboard:write':
      valid = singleArgument(args, (value) => typeof value === 'string')
      break
    case 'review:activate': valid = singleArgument(args, isReviewId); break
    case 'review:autosave':
      valid = args.length === 2 &&
        (args[0] === null || isReviewId(args[0])) &&
        isReviewTree(args[1]) &&
        (
          args[0] === null ||
          !isRecord(args[1].review) ||
          args[1].review.id === args[0]
        )
      break
    case 'review:done': valid = singleArgument(args, isReviewTree); break
  }
  if (!valid) throw new IpcContractError(channel, 'renderer-to-main send')
}

export function assertRendererInvokeResult(
  channel: RendererInvokeChannel,
  value: unknown
): void {
  let valid = false
  switch (channel) {
    case 'startup:info': valid = isStartupInfo(value); break
    case 'startup:phase':
    case 'startup:copy-diagnostic':
    case 'startup:reveal-diagnostic':
    case 'smoke:result':
    case 'review:context-menu:open':
      valid = value === undefined
      break
    case 'startup:renderer-initialized': valid = isStartupReady(value); break
    case 'startup:failure':
      valid = hasExactKeys(value, ['diagnosticAvailable']) &&
        typeof value.diagnosticAvailable === 'boolean'
      break
    case 'document:open':
    case 'review:initial-document':
      valid = value === null || isDocument(value)
      break
    case 'brand:assets':
      valid = hasExactKeys(value, ['mark', 'logotype', 'lockup']) &&
        typeof value.mark === 'string' &&
        typeof value.logotype === 'string' &&
        typeof value.lockup === 'string'
      break
    case 'document:checksum': valid = isChecksum(value); break
    case 'attachment:save': valid = isReviewAttachment(value); break
    case 'attachment:remove': valid = isAttachmentRemoveResult(value); break
    case 'clipboard:read-image': valid = value === null || isClipboardImage(value); break
    case 'review:autosave-status:get': valid = isReviewAutosaveStatus(value); break
    case 'settings:get':
    case 'settings:update':
      valid = isSettingsEnvelope(value)
      break
    case 'window:focus-state:get': valid = isWindowFocusState(value); break
    case 'review:list':
      valid = Array.isArray(value) && value.every(isDocument)
      break
  }
  if (!valid) throw new IpcContractError(channel, 'main-to-renderer result')
}

export function assertMainEventArguments(
  channel: MainEventChannel,
  args: readonly unknown[]
): void {
  let valid = false
  switch (channel) {
    case 'document:open-request':
    case 'settings:open':
      valid = noArguments(args)
      break
    case 'settings:changed': valid = singleArgument(args, isSettingsEnvelope); break
    case 'window:focus-state': valid = singleArgument(args, isWindowFocusState); break
    case 'review:opened': valid = singleArgument(args, isDocument); break
    case 'review:status': valid = singleArgument(args, isReviewStatusRequest); break
    case 'review:snapshot-request':
      valid = singleArgument(args, isReviewSnapshotRequest)
      break
    case 'review:autosave-status':
      valid = singleArgument(args, isReviewAutosaveStatus)
      break
    case 'review:shutdown-state':
      valid = singleArgument(args, (value) => typeof value === 'boolean')
      break
    case 'review:activation-request':
      valid = singleArgument(args, isActivationRequest)
      break
    case 'review:trashed': valid = singleArgument(args, isReviewTrashedEvent); break
  }
  if (!valid) throw new IpcContractError(channel, 'main-to-renderer event')
}
