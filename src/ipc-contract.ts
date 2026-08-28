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
import {
  isDevelopmentElementCalloutCommand,
  isDevelopmentElementCalloutResult,
  type DevelopmentElementCalloutCommand,
  type DevelopmentElementCalloutResult
} from './development-element'
import { isReviewArtifact, isReviewTree } from './review-format'
import { isWorkspaceState } from './workspace-state'

const REVIEW_ID_PATTERN = /^mko_[a-zA-Z0-9]{6,32}$/
const ATTACHMENT_ID_PATTERN = /^img-[1-9]\d*$/
const REQUEST_ID_PATTERN = /^(?:activation|resolution|snapshot|status|trash)-[1-9]\d*$/
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/

const SETTINGS_KEYS = [
  'palette',
  'appearance',
  'treeDensity',
  'annotationTextSize',
  'zoomPercent',
  'showKeyboardHelp',
  'openLeftPane',
  'defaultTreeView',
  'confirmAttachmentRemoval',
  'incomingReviewActivationPolicy',
  'reviewLinkActivationPolicy',
  'incomingReviewIdleMinutes',
  'discoverAgentThreadFromLocalSessions',
  'remoteCanonicalGatewayEnabled',
  't3ThreadTitlesEnabled',
  't3MetadataDatabasePath',
  'codexThreadTitlesEnabled',
  'codexExecutablePath',
  'claudeThreadTitlesEnabled',
  'inboxTitlePreference',
  'logRejectedApiRequests',
  'agentReviewMode',
  'agentInterpretationPolicy',
  'autosaveMaximumDelayMs'
] as const

export interface ReviewContextMenuRequest {
  reviewId: string
  x: number
  y: number
}

export interface ReviewContextMenuResult {
  outcome: 'copied' | 'copy-cancelled' | 'dismissed'
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
  'review:create-local': [ReviewTree]
  'brand:assets': []
  'document:checksum': [string]
  'attachment:save': [MarkoverClipboardImage, string]
  'clipboard:read-image': []
  'review:autosave-status:get': []
  'settings:get': []
  'settings:update': [unknown]
  'workspace:get': []
  'workspace:update': [MarkoverWorkspaceState]
  'window:focus-state:get': []
  'review:initial-document': []
  'review:list': []
  'review:t3-thread-titles:get': []
  'review:codex-thread-titles:get': []
  'review:claude-thread-titles:get': []
  'review:project-favicon:get': [string]
  'review:pull-request:open': [string]
  'review:context-menu:open': [ReviewContextMenuRequest]
  'review:resolve': [ReviewResolutionRequest]
  'review:unresolve': [string]
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
  'review:create-local': MarkoverDocument
  'brand:assets': MarkoverBrandAssets
  'document:checksum': string
  'attachment:save': ReviewAttachment
  'clipboard:read-image': MarkoverClipboardImage | null
  'review:autosave-status:get': ReviewAutosaveStatus
  'settings:get': MarkoverSettingsEnvelope
  'settings:update': MarkoverSettingsEnvelope
  'workspace:get': MarkoverWorkspaceState
  'workspace:update': MarkoverWorkspaceState
  'window:focus-state:get': MarkoverWindowFocusState
  'review:initial-document': MarkoverDocument | null
  'review:list': MarkoverReviewListItem[]
  'review:t3-thread-titles:get': T3ThreadTitleSnapshot
  'review:codex-thread-titles:get': CodexThreadTitleSnapshot
  'review:claude-thread-titles:get': ClaudeThreadTitleSnapshot
  'review:project-favicon:get': string | null
  'review:pull-request:open': undefined
  'review:context-menu:open': ReviewContextMenuResult
  'review:resolve': ReviewResolutionResult
  'review:unresolve': ReviewUnresolveResult
  'attachment:remove': AttachmentRemoveResult
}

export interface RendererSendArguments {
  'startup:quit': []
  'review:snapshot-response': [ReviewSnapshotResponse]
  'review:status-response': [ReviewStatusResponse]
  'review:activation-response': [ReviewActivationResponse]
  'review:resolution-confirmation-response': [ReviewResolutionConfirmationResponse]
  'review:trash-confirmation-response': [ReviewTrashConfirmationResponse]
  'clipboard:write': [string]
  'review:activate': [string]
  'review:autosave': [string, ReviewTree]
  'development:element-callout-response': [DevelopmentElementCalloutResult]
}

export interface MainEventArguments {
  'document:open-request': []
  'settings:open': []
  'review:batch-mode-request': []
  'settings:changed': [MarkoverSettingsEnvelope]
  'window:focus-state': [MarkoverWindowFocusState]
  'review:opened': [MarkoverDocument]
  'review:updated': [MarkoverDocument]
  'review:status': [ReviewStatusRequest]
  'review:snapshot-request': [ReviewSnapshotRequest]
  'review:autosave-status': [ReviewAutosaveStatus]
  'review:shutdown-state': [boolean]
  'review:activation-request': [ReviewActivationRequest]
  'review:resolution-confirmation-request': [ReviewResolutionConfirmationRequest]
  'review:trash-confirmation-request': [ReviewTrashConfirmationRequest]
  'review:trashed': [ReviewTrashedEvent]
  'development:element-callout': [DevelopmentElementCalloutCommand]
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

function isProjectEvidence(value: unknown): value is ReviewProjectEvidence {
  return value === 'verified' || value === 'conflict' || value === 'unavailable'
}

function isSourceState(value: unknown): value is ReviewSourceState {
  return value === 'unchanged' || value === 'changed' ||
    value === 'missing' || value === 'unavailable'
}

function isReviewAttachment(value: unknown): value is ReviewAttachment {
  if (!isRecord(value) || !isAttachmentId(value.id)) return false
  if (value.type !== undefined && value.type !== 'image') return false
  for (const field of ['label', 'path', 'mimeType', 'url'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false
  }
  if (value.checksum !== undefined && !isChecksum(value.checksum)) return false
  return ['width', 'height'].every((field) => (
    value[field] === undefined ||
    value[field] === null ||
    isPositiveInteger(value[field])
  ))
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
    'project',
    'projectEvidence',
    'sourceState',
    'tree'
  ])) return false
  if (
    !isStringOrNull(value.name) ||
    !isStringOrNull(value.path) ||
    typeof value.source !== 'string' ||
    !isChecksum(value.checksum) ||
    (value.reviewId !== undefined && !isReviewId(value.reviewId)) ||
    (value.projectEvidence !== undefined && !isProjectEvidence(value.projectEvidence)) ||
    (value.sourceState !== undefined && !isSourceState(value.sourceState)) ||
    (value.project !== undefined && value.project !== null && !(
      isRecord(value.project) &&
      hasExactKeys(value.project, ['key', 'name', 'root']) &&
      typeof value.project.key === 'string' &&
      Boolean(value.project.key) &&
      typeof value.project.name === 'string' &&
      Boolean(value.project.name) &&
      isStringOrNull(value.project.root)
    )) ||
    (
      value.tree !== undefined &&
      (
        value.reviewId !== undefined
          ? !isReviewSessionTree(value.tree, value.reviewId)
          : !isReviewTree(value.tree)
      )
    )
  ) return false
  if (value.reviewId !== undefined && value.tree === undefined) return false
  if (value.reviewId !== undefined && (
    !isProjectEvidence(value.projectEvidence) ||
    !isSourceState(value.sourceState)
  )) return false
  const tree = value.tree as ReviewTree | undefined
  if (tree && (
    tree.sourceDocument.content !== value.source ||
    tree.sourceDocument.checksum !== value.checksum
  )) return false
  if (
    value.reviewId &&
    isRecord(tree?.review) &&
    tree.review.id !== value.reviewId
  ) return false
  return true
}

function isIncompatibleReview(
  value: unknown
): value is MarkoverIncompatibleReview {
  return hasExactKeys(value, [
    'kind',
    'reviewId',
    'format',
    'version',
    'compatibilityUrl'
  ]) &&
    value.kind === 'incompatible-review' &&
    isReviewId(value.reviewId) &&
    typeof value.format === 'string' &&
    typeof value.version === 'string' &&
    typeof value.compatibilityUrl === 'string' &&
    value.compatibilityUrl.startsWith(
      'https://lastobelus.github.io/markover/compatibility/?'
    )
}

function isReviewSessionTree(
  value: unknown,
  reviewId: string
): value is ReviewSessionTree {
  if (!isRecord(value) || !isRecord(value.review) || value.review.id !== reviewId) {
    return false
  }
  if (value.review.status !== 'handoff-in-progress') {
    return isReviewArtifact(value)
  }
  return isReviewArtifact({
    ...value,
    review: {
      ...value.review,
      status: 'editing'
    }
  })
}

function isStartupWarningValue(value: unknown): value is StartupWarning {
  return hasExactKeys(value, ['category', 'subject']) &&
    (
      value.category === 'brand-fallback' ||
      value.category === 'review-skipped' ||
      value.category === 'settings-recovered' ||
      value.category === 'workspace-recovered'
    ) &&
    typeof value.subject === 'string'
}

function isStartupInfo(value: unknown): value is StartupInfo {
  return hasExactKeys(value, [
    'development',
    'diagnosticPath',
    'elementCallouts',
    'holdPhase',
    'failPhase',
    'smoke'
  ]) &&
    typeof value.development === 'boolean' &&
    typeof value.diagnosticPath === 'string' &&
    typeof value.elementCallouts === 'boolean' &&
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
    'attachmentImage',
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
    case 'zoomPercent':
      return value === 80 ||
        value === 90 ||
        value === 100 ||
        value === 110 ||
        value === 125 ||
        value === 150
    case 'defaultTreeView': return value === 'all' || value === 'annotated'
    case 'incomingReviewActivationPolicy':
    case 'reviewLinkActivationPolicy':
      return value === 'never' ||
        value === 'always' ||
        value === 'warn' ||
        value === 'when-idle'
    case 'agentReviewMode':
      return value === 'annotation-only' ||
        value === 'annotations-and-source-proposals'
    case 'inboxTitlePreference':
      return value === 'review-purpose' || value === 'requesting-thread-title'
    case 'showKeyboardHelp':
    case 'openLeftPane':
    case 'confirmAttachmentRemoval':
    case 'discoverAgentThreadFromLocalSessions':
    case 'remoteCanonicalGatewayEnabled':
    case 't3ThreadTitlesEnabled':
    case 'codexThreadTitlesEnabled':
    case 'claudeThreadTitlesEnabled':
    case 'logRejectedApiRequests':
      return typeof value === 'boolean'
    case 'agentInterpretationPolicy': return typeof value === 'string'
    case 't3MetadataDatabasePath': return typeof value === 'string'
    case 'codexExecutablePath': return typeof value === 'string'
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

function isT3ThreadTitle(value: unknown): value is T3ThreadTitle {
  return hasExactKeys(value, ['threadId', 'title']) &&
    typeof value.threadId === 'string' &&
    Boolean(value.threadId.trim()) &&
    typeof value.title === 'string' &&
    Boolean(value.title.trim())
}

function isT3ThreadTitleSnapshot(
  value: unknown
): value is T3ThreadTitleSnapshot {
  return hasExactKeys(value, ['status', 'detail', 'titles']) &&
    (
      value.status === 'disabled' ||
      value.status === 'available' ||
      value.status === 'unavailable'
    ) &&
    typeof value.detail === 'string' &&
    Array.isArray(value.titles) &&
    value.titles.every(isT3ThreadTitle) &&
    (value.status === 'available' || value.titles.length === 0)
}

function isCodexThreadTitle(value: unknown): value is CodexThreadTitle {
  return hasExactKeys(value, ['threadId', 'title']) &&
    typeof value.threadId === 'string' &&
    Boolean(value.threadId.trim()) &&
    typeof value.title === 'string' &&
    Boolean(value.title.trim())
}

function isCodexThreadTitleSnapshot(
  value: unknown
): value is CodexThreadTitleSnapshot {
  return hasExactKeys(value, ['status', 'detail', 'titles']) &&
    (
      value.status === 'disabled' ||
      value.status === 'available' ||
      value.status === 'unavailable'
    ) &&
    typeof value.detail === 'string' &&
    Array.isArray(value.titles) &&
    value.titles.every(isCodexThreadTitle) &&
    (value.status === 'available' || value.titles.length === 0)
}

function isClaudeThreadTitle(value: unknown): value is ClaudeThreadTitle {
  return hasExactKeys(value, ['threadId', 'title']) &&
    typeof value.threadId === 'string' &&
    Boolean(value.threadId.trim()) &&
    typeof value.title === 'string' &&
    Boolean(value.title.trim())
}

function isClaudeThreadTitleSnapshot(
  value: unknown
): value is ClaudeThreadTitleSnapshot {
  return hasExactKeys(value, ['status', 'detail', 'titles']) &&
    (
      value.status === 'disabled' ||
      value.status === 'available' ||
      value.status === 'unavailable'
    ) &&
    typeof value.detail === 'string' &&
    Array.isArray(value.titles) &&
    value.titles.every(isClaudeThreadTitle) &&
    (value.status === 'available' || value.titles.length === 0)
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
      value.status === 'agent-reviewing' ||
      value.status === 'reviewed' ||
      value.status === 'revised' ||
      value.status === 'done' ||
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

function isManualResolutionOutcome(
  value: unknown
): value is ManualReviewResolutionRequestOutcome {
  return value === 'reviewed-no-notes' || value === 'accepted-unreviewed'
}

function isReviewResolutionRequest(
  value: unknown
): value is ReviewResolutionRequest {
  return hasExactKeys(value, ['reviewIds', 'outcome']) &&
    Array.isArray(value.reviewIds) &&
    value.reviewIds.length > 0 &&
    value.reviewIds.every(isReviewId) &&
    new Set(value.reviewIds).size === value.reviewIds.length &&
    isManualResolutionOutcome(value.outcome)
}

function isResolution(value: unknown): value is ReviewResolution {
  return hasExactKeys(value, ['outcome', 'resolvedAt']) &&
    (
      value.outcome === 'feedback-addressed' ||
      value.outcome === 'reviewed-no-notes' ||
      value.outcome === 'accepted-unreviewed' ||
      value.outcome === 'feedback-abandoned' ||
      value.outcome === 'merged-unresolved'
    ) &&
    typeof value.resolvedAt === 'string' &&
    Number.isFinite(Date.parse(value.resolvedAt))
}

function isReviewResolutionResult(
  value: unknown
): value is ReviewResolutionResult {
  return hasExactKeys(value, ['outcome', 'reviews']) &&
    (value.outcome === 'cancelled' || value.outcome === 'resolved') &&
    Array.isArray(value.reviews) &&
    value.reviews.every((review) => (
      hasExactKeys(review, ['reviewId', 'status'], ['resolution']) &&
      isReviewId(review.reviewId) &&
      isReviewStatusRequest({
        requestId: 'status-1',
        reviewId: review.reviewId,
        status: review.status
      }) &&
      (review.resolution === undefined || isResolution(review.resolution))
    ))
}

function isResolutionSummaryBlock(value: unknown): boolean {
  return hasExactKeys(value, [
    'nodeId',
    'title',
    'feedback',
    'attachments',
    'sourceEdit'
  ]) &&
    typeof value.nodeId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.feedback === 'string' &&
    Array.isArray(value.attachments) &&
    value.attachments.every((item) => typeof item === 'string') &&
    (value.sourceEdit === null || (
      hasExactKeys(value.sourceEdit, ['original', 'current']) &&
      typeof value.sourceEdit.original === 'string' &&
      typeof value.sourceEdit.current === 'string'
    ))
}

function isResolutionSummary(value: unknown): boolean {
  return hasExactKeys(value, [
    'reviewId',
    'documentName',
    'contextSummary',
    'blocks'
  ]) &&
    isReviewId(value.reviewId) &&
    typeof value.documentName === 'string' &&
    typeof value.contextSummary === 'string' &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isResolutionSummaryBlock)
}

function isResolutionConfirmationRequest(
  value: unknown
): value is ReviewResolutionConfirmationRequest {
  return hasExactKeys(value, ['requestId', 'outcome', 'reviews']) &&
    isRequestId(value.requestId) &&
    isManualResolutionOutcome(value.outcome) &&
    Array.isArray(value.reviews) &&
    value.reviews.length > 0 &&
    value.reviews.every(isResolutionSummary)
}

function isResolutionConfirmationResponse(
  value: unknown
): value is ReviewResolutionConfirmationResponse {
  return hasExactKeys(value, ['requestId', 'confirmed']) &&
    isRequestId(value.requestId) &&
    typeof value.confirmed === 'boolean'
}

function isTrashConfirmationRequest(
  value: unknown
): value is ReviewTrashConfirmationRequest {
  return hasExactKeys(value, ['requestId', 'reviewId', 'pendingAgent']) &&
    isRequestId(value.requestId) &&
    isReviewId(value.reviewId) &&
    typeof value.pendingAgent === 'boolean'
}

function isTrashConfirmationResponse(
  value: unknown
): value is ReviewTrashConfirmationResponse {
  return hasExactKeys(value, ['requestId', 'confirmed']) &&
    isRequestId(value.requestId) &&
    typeof value.confirmed === 'boolean'
}

function isActivationOutcome(value: unknown): value is ReviewActivationOutcome {
  return value === 'activated' ||
    value === 'already-active' ||
    value === 'blocked' ||
    value === 'deferred' ||
    value === 'missing'
}

function isActivationRequest(value: unknown): value is ReviewActivationRequest {
  return hasExactKeys(value, [
    'requestId',
    'reviewId',
    'document',
    'focusState'
  ]) &&
    isRequestId(value.requestId) &&
    isReviewId(value.reviewId) &&
    isWindowFocusState(value.focusState) &&
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
  return hasExactKeys(value, ['reviewId', 'x', 'y']) &&
    isReviewId(value.reviewId) &&
    typeof value.x === 'number' && Number.isSafeInteger(value.x) && value.x >= 0 &&
    typeof value.y === 'number' && Number.isSafeInteger(value.y) && value.y >= 0
}

function isContextMenuResult(value: unknown): value is ReviewContextMenuResult {
  return hasExactKeys(value, ['outcome']) && (
    value.outcome === 'copied' ||
    value.outcome === 'copy-cancelled' ||
    value.outcome === 'dismissed'
  )
}

function isAttachmentRemoveRequest(value: unknown): value is AttachmentRemoveRequest {
  return hasExactKeys(value, ['reviewId', 'attachmentId', 'tree']) &&
    isReviewId(value.reviewId) &&
    isAttachmentId(value.attachmentId) &&
    isReviewSessionTree(value.tree, value.reviewId)
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
    case 'workspace:get':
    case 'window:focus-state:get':
    case 'review:initial-document':
    case 'review:list':
    case 'review:t3-thread-titles:get':
    case 'review:codex-thread-titles:get':
    case 'review:claude-thread-titles:get':
      valid = noArguments(args)
      break
    case 'review:project-favicon:get':
    case 'review:pull-request:open':
    case 'review:unresolve':
      valid = singleArgument(args, isReviewId)
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
    case 'review:create-local': valid = singleArgument(args, isReviewTree); break
    case 'attachment:save':
      valid = args.length === 2 &&
        isClipboardImage(args[0]) &&
        isReviewId(args[1])
      break
    case 'settings:update': valid = singleArgument(args, isSettingsPatch); break
    case 'workspace:update': valid = singleArgument(args, isWorkspaceState); break
    case 'review:context-menu:open':
      valid = singleArgument(args, isContextMenuRequest)
      break
    case 'review:resolve':
      valid = singleArgument(args, isReviewResolutionRequest)
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
    case 'review:resolution-confirmation-response':
      valid = singleArgument(args, isResolutionConfirmationResponse)
      break
    case 'review:trash-confirmation-response':
      valid = singleArgument(args, isTrashConfirmationResponse)
      break
    case 'clipboard:write':
      valid = singleArgument(args, (value) => typeof value === 'string')
      break
    case 'review:activate': valid = singleArgument(args, isReviewId); break
    case 'review:autosave':
      valid = args.length === 2 &&
        isReviewId(args[0]) &&
        isReviewSessionTree(args[1], args[0]) &&
        args[1].review.status === 'editing'
      break
    case 'development:element-callout-response':
      valid = singleArgument(args, isDevelopmentElementCalloutResult)
      break
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
    case 'review:pull-request:open':
      valid = value === undefined
      break
    case 'review:context-menu:open': valid = isContextMenuResult(value); break
    case 'review:resolve': valid = isReviewResolutionResult(value); break
    case 'review:unresolve':
      valid = hasExactKeys(value, ['reviewId', 'status']) &&
        isReviewId(value.reviewId) &&
        value.status === 'editing'
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
    case 'review:create-local': valid = isDocument(value); break
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
    case 'workspace:get':
    case 'workspace:update':
      valid = isWorkspaceState(value)
      break
    case 'window:focus-state:get': valid = isWindowFocusState(value); break
    case 'review:list':
      valid = Array.isArray(value) && value.every((item) => (
        isDocument(item) || isIncompatibleReview(item)
      ))
      break
    case 'review:t3-thread-titles:get':
      valid = isT3ThreadTitleSnapshot(value)
      break
    case 'review:codex-thread-titles:get':
      valid = isCodexThreadTitleSnapshot(value)
      break
    case 'review:claude-thread-titles:get':
      valid = isClaudeThreadTitleSnapshot(value)
      break
    case 'review:project-favicon:get':
      valid = value === null || (
        typeof value === 'string' &&
        /^data:image\/(?:png|x-icon|svg\+xml);base64,[A-Za-z0-9+/]+=*$/.test(value)
      )
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
    case 'review:batch-mode-request':
      valid = noArguments(args)
      break
    case 'settings:changed': valid = singleArgument(args, isSettingsEnvelope); break
    case 'window:focus-state': valid = singleArgument(args, isWindowFocusState); break
    case 'review:opened':
    case 'review:updated':
      valid = singleArgument(args, isDocument)
      break
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
    case 'review:resolution-confirmation-request':
      valid = singleArgument(args, isResolutionConfirmationRequest)
      break
    case 'review:trash-confirmation-request':
      valid = singleArgument(args, isTrashConfirmationRequest)
      break
    case 'review:trashed': valid = singleArgument(args, isReviewTrashedEvent); break
    case 'development:element-callout':
      valid = singleArgument(args, isDevelopmentElementCalloutCommand)
      break
  }
  if (!valid) throw new IpcContractError(channel, 'main-to-renderer event')
}
