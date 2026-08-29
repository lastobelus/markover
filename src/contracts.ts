import type {
  RendererInitialization,
  RendererSmokeResult,
  RendererStartupFailure,
  RendererStartupFailureResult,
  StartupInfo,
  StartupPhaseEvent,
  StartupReady
} from './startup-contract'
import type {
  DevelopmentElementCalloutCommand,
  DevelopmentElementCalloutResult
} from './development-element'

export interface DiffStats {
  additions: number
  deletions: number
}

export interface SyntaxHighlightToken {
  content: string
  lightColor: string
  darkColor: string
  fontStyle: number
}

export interface SyntaxHighlightResult {
  lines: SyntaxHighlightToken[][]
}

export interface DiffRenderer {
  highlight(
    source: string,
    language: string
  ): Promise<SyntaxHighlightResult | null>
  render(
    container: HTMLElement,
    original: string,
    current: string,
    key?: string
  ): () => void
  stats(original: string, current: string): DiffStats
}

declare global {
  interface MarkoverStartupUi {
    development: (value: boolean) => void
    phase: (value: string) => void
    ready: () => void
    fail: (diagnosticAvailable?: boolean) => void
  }
  type MarkoverDiffStats = DiffStats
  type Palette = 'ember' | 'ocean' | 'olive'
  type Appearance = 'system' | 'light' | 'dark'
  type ResolvedAppearance = 'light' | 'dark'
  type TreeDensity = 'comfortable' | 'compact'
  type AnnotationTextSize = 'small' | 'medium' | 'large'
  type ZoomPercent = 80 | 90 | 100 | 110 | 125 | 150
  type DefaultTreeView = 'all' | 'annotated'
  type AgentReviewMode =
    | 'annotation-only'
    | 'annotations-and-source-proposals'
  type IncomingReviewActivationPolicy =
    | 'never'
    | 'always'
    | 'warn'
    | 'when-idle'
  type InboxTitlePreference = 'review-purpose' | 'requesting-thread-title'
  type DarkColorization = 'high' | 'mid' | 'low'

  interface AgentGuidance {
    fixedContract: string
    interpretationPolicy: string
  }

  interface MarkoverAgentGuidanceApi {
    FIXED_CONTRACT_STATEMENTS: readonly string[]
    FIXED_CONTRACT: string
    DEFAULT_INTERPRETATION_POLICY: string
    guidance: (interpretationPolicy?: unknown) => AgentGuidance
  }

  interface MarkoverSettings {
    palette: Palette
    appearance: Appearance
    treeDensity: TreeDensity
    annotationTextSize: AnnotationTextSize
    zoomPercent: ZoomPercent
    showKeyboardHelp: boolean
    openLeftPane: boolean
    defaultTreeView: DefaultTreeView
    confirmAttachmentRemoval: boolean
    incomingReviewActivationPolicy: IncomingReviewActivationPolicy
    reviewLinkActivationPolicy: IncomingReviewActivationPolicy
    incomingReviewIdleMinutes: number
    discoverAgentThreadFromLocalSessions: boolean
    remoteCanonicalGatewayEnabled: boolean
    t3ThreadTitlesEnabled: boolean
    t3MetadataDatabasePath: string
    codexThreadTitlesEnabled: boolean
    codexExecutablePath: string
    claudeThreadTitlesEnabled: boolean
    inboxTitlePreference: InboxTitlePreference
    logRejectedApiRequests: boolean
    agentReviewMode: AgentReviewMode
    agentInterpretationPolicy: string
    autosaveMaximumDelayMs: number
  }

  interface SettingsView {
    root: HTMLElement
    form: HTMLFormElement
    keyboardHelp: HTMLElement
  }

  interface AppliedSettings {
    appearance: ResolvedAppearance
    preferences: MarkoverSettings
  }

  interface MarkoverSettingsEnvelope extends MarkoverSettings {
    resolvedAppearance: ResolvedAppearance
  }

  type WorkspaceNavigationMode = 'inbox' | 'projects'
  type WorkspaceAnnotationView = 'selected' | 'list'

  interface WorkspaceProjectExpansion {
    projectKey: string
    expanded: boolean
  }

  interface WorkspaceThreadExpansion {
    projectKey: string
    threadKey: string
    expanded: boolean
  }

  interface WorkspaceReviewViewState {
    selectedBlockId: string | null
    annotatedOnly: boolean
    annotationView: WorkspaceAnnotationView
    sourceCollapsed: boolean
    collapsedBlockIds: string[]
  }

  interface MarkoverWorkspaceState {
    format: 'markover-workspace'
    version: 3
    initialized: boolean
    navigationMode: WorkspaceNavigationMode
    projectExpansion: WorkspaceProjectExpansion[]
    threadExpansion: WorkspaceThreadExpansion[]
    activeReviewId: string | null
    rightPaneWidth: number | null
    reviews: Record<string, WorkspaceReviewViewState>
  }

  interface MarkoverSettingsApi {
    DEFAULT_SETTINGS: Readonly<MarkoverSettings>
    ZOOM_LEVELS: readonly ZoomPercent[]
    DARK_COLORIZATION: Readonly<Record<Palette, DarkColorization>>
    WINDOW_BACKGROUNDS: Readonly<{
      light: Readonly<Record<Palette, string>>
      dark: Readonly<
        Record<DarkColorization, Readonly<Record<Palette, string>>>
      >
    }>
    OPTIONS: Readonly<{
      palette: readonly Palette[]
      appearance: readonly Appearance[]
      treeDensity: readonly TreeDensity[]
      annotationTextSize: readonly AnnotationTextSize[]
      zoomPercent: readonly ZoomPercent[]
      defaultTreeView: readonly DefaultTreeView[]
      incomingReviewActivationPolicy: readonly IncomingReviewActivationPolicy[]
      reviewLinkActivationPolicy: readonly IncomingReviewActivationPolicy[]
      inboxTitlePreference: readonly InboxTitlePreference[]
      agentReviewMode: readonly AgentReviewMode[]
    }>
    normalizeSettings: (value?: unknown) => MarkoverSettings
    updateSettings: (current: unknown, patch: unknown) => MarkoverSettings
    adjacentZoomPercent: (
      current: ZoomPercent,
      direction: -1 | 1
    ) => ZoomPercent
    minimumWindowSize: (
      zoomPercent: ZoomPercent,
      maximum?: { width: number; height: number }
    ) => { width: number; height: number }
    windowBackground: (
      settings: unknown,
      resolvedAppearance?: string
    ) => string
    applySettingsToView: (
      settings: unknown,
      view: SettingsView
    ) => AppliedSettings
    darkColorization: (palette: unknown) => DarkColorization
    leftPanePreferenceChanged: (
      previous: MarkoverSettings,
      next: MarkoverSettings,
      initial?: boolean
    ) => boolean
    confirmScreenshotRemoval: (
      settings: unknown,
      label: string,
      confirmRemoval: (message: string) => boolean
    ) => boolean
  }

  interface SourceEdit {
    original: string
    current: string
  }

  interface SourceEditableNode {
    id: string
    raw: string
    sourceEdit?: SourceEdit
  }

  interface SourceEditorState {
    sourceDrafts: Map<string, string>
    sourceEditingId: string | null
  }

  type SourceEditCommitResult =
    | { ok: true; changed: boolean; reason: null }
    | { ok: false; changed: false; reason: 'not-editing' | 'empty' }

  interface MarkoverSourceEditsApi {
    savedSource: (node: SourceEditableNode) => string
    begin: (state: SourceEditorState, node: SourceEditableNode) => string
    update: (
      state: SourceEditorState,
      node: SourceEditableNode,
      value: string
    ) => boolean
    commit: (
      state: SourceEditorState,
      node: SourceEditableNode
    ) => SourceEditCommitResult
    cancel: (state: SourceEditorState, node: SourceEditableNode) => void
  }

  interface ReviewAttachment {
    id: string
    type?: 'image'
    label?: string
    path?: string
    mimeType?: string
    url?: string
    checksum?: string
    width?: number | null
    height?: number | null
  }

  type ReviewNodeType =
    | 'document'
    | 'heading'
    | 'paragraph'
    | 'blockquote'
    | 'table'
    | 'thematic-break'
    | 'ordered-item'
    | 'unordered-item'
    | 'code'
    | 'frontmatter'
    | 'frontmatter-entry'

  interface ReviewNodeBase<T extends ReviewNodeType> extends SourceEditableNode {
    type: T
    text: string
    lineStart: number
    lineEnd: number
    feedback: string
    children: ReviewNode[]
    sourceEditable?: boolean
    attachments?: ReviewAttachment[]
  }

  type DocumentNode = ReviewNodeBase<'document'>
  interface HeadingNode extends ReviewNodeBase<'heading'> { level: number }
  type ParagraphNode = ReviewNodeBase<'paragraph'>
  type BlockquoteNode = ReviewNodeBase<'blockquote'>
  type TableNode = ReviewNodeBase<'table'>
  type ThematicBreakNode = ReviewNodeBase<'thematic-break'>

  interface ListItemNodeBase<
    T extends 'ordered-item' | 'unordered-item'
  > extends ReviewNodeBase<T> {
    marker: string
    listId: string
    listPosition: number
    listLength: number | null
    task?: true
    checked?: boolean
  }

  type OrderedItemNode = ListItemNodeBase<'ordered-item'>
  type UnorderedItemNode = ListItemNodeBase<'unordered-item'>
  interface CodeNode extends ReviewNodeBase<'code'> { language: string }
  interface FrontmatterNode extends ReviewNodeBase<'frontmatter'> {
    sourceEditable: false
  }
  interface FrontmatterEntryNode extends ReviewNodeBase<'frontmatter-entry'> {
    key: string
  }

  type ReviewNode =
    | DocumentNode
    | HeadingNode
    | ParagraphNode
    | BlockquoteNode
    | TableNode
    | ThematicBreakNode
    | OrderedItemNode
    | UnorderedItemNode
    | CodeNode
    | FrontmatterNode
    | FrontmatterEntryNode

  interface SourceDocument {
    name: string | null
    path: string | null
    content: string
    checksum: string
  }

  interface UnsupportedSourceLine {
    line: number
    text: string
  }

  interface ReviewTree {
    format: 'markover-review'
    version: 1
    sourceDocument: SourceDocument
    unsupported: UnsupportedSourceLine[]
    root: DocumentNode
    review?: unknown
  }

  type ReviewStatus =
    | 'editing'
    | 'pending-agent'
    | 'agent-reviewing'
    | 'reviewed'
    | 'revised'
    | 'done'

  type ReviewResolutionOutcome =
    | 'feedback-addressed'
    | 'reviewed-no-notes'
    | 'accepted-unreviewed'
    | 'feedback-abandoned'
    | 'merged-unresolved'

  interface ReviewResolution {
    [key: string]: unknown
    outcome: ReviewResolutionOutcome
    resolvedAt: string
  }

  interface ReviewThreadHost {
    [key: string]: unknown
    kind: string
    provider: string
    threadId?: string
    machine?: string
  }

  interface ReviewAgentThread {
    [key: string]: unknown
    id: string
    threadHost: ReviewThreadHost
  }

  interface ReviewGitSnapshot {
    [key: string]: unknown
    repositoryUrl?: string
    branch?: string
    commit?: string
  }

  interface ReviewPullRequest {
    [key: string]: unknown
    number: number
    url: string
    status?: 'draft' | 'open' | 'merged' | 'closed'
    statusObservedAt?: string
    statusSource?: string
  }

  interface ReviewAgentReviewer {
    [key: string]: unknown
    mode: AgentReviewMode
    claimId: string
    agentThread: ReviewAgentThread | null
    startedAt: string
    completedAt: string | null
    agentGuidance: AgentGuidance
  }

  interface ReviewCreationReceipt {
    [key: string]: unknown
    version: 1
    keyDigest: string
    requestDigest: string
  }

  interface ReviewEnvelope {
    [key: string]: unknown
    id: string
    status: ReviewStatus
    origin: string
    createdAt: string
    updatedAt: string
    attentionRequestedAt: string
    contextSummary: string
    agentThread: ReviewAgentThread | null
    git: ReviewGitSnapshot | null
    pullRequest: ReviewPullRequest | null
    creationReceipt?: ReviewCreationReceipt
    resolution?: ReviewResolution
    agentGuidance: AgentGuidance
    agentReviewer?: ReviewAgentReviewer
  }

  type ReviewArtifact = Omit<ReviewTree, 'review'> & {
    review: ReviewEnvelope
  }

  interface ReviewDocumentInput {
    name?: string | null
    path?: string | null
  }

  interface YamlDiagnostic {
    line: number | null
    column: number | null
    message: string
  }

  type ReviewNodeVisitor = (
    node: ReviewNode,
    parent: ReviewNode | null,
    ancestors: ReviewNode[]
  ) => void

  interface MarkoverTreeApi {
    findNode: (
      root: ReviewNode | null | undefined,
      id: string | null | undefined
    ) => ReviewNode | null
    nodePosition: (
      root: ReviewNode,
      id: string
    ) => { index: number; total: number }
    parseMarkdown: (
      source: string,
      checksum?: string,
      document?: ReviewDocumentInput
    ) => ReviewTree
    serializeTree: (tree: ReviewTree) => string
    visitNodes: (
      root: ReviewNode,
      visitor: ReviewNodeVisitor,
      parent?: ReviewNode | null,
      ancestors?: ReviewNode[]
    ) => void
    yamlDiagnostic: (source: string) => YamlDiagnostic | null
  }

  interface AnnotationBlockNode {
    id?: string
    text?: unknown
    raw?: unknown
    sourceEdit?: SourceEdit
    feedback?: unknown
    lineStart?: number
    lineEnd?: number
    attachments?: ReviewAttachment[]
  }

  type AnnotationModelNode = AnnotationBlockNode & {
    lineStart: number
    lineEnd: number
  }

  interface RenderedAnnotationNode extends AnnotationBlockNode {
    id: string
    lineStart: number
    lineEnd: number
  }

  interface AnnotationContext {
    descriptor?: string
    lineLabel?: string
  }

  interface AnnotationViewModel {
    attachments: Array<{
      attachment: ReviewAttachment
      label: string
    }>
    feedback: string
    lineLabel: string
    sourceTitle: string
  }

  interface AnnotationCreateOptions<
    TNode extends RenderedAnnotationNode = RenderedAnnotationNode
  > {
    node: TNode
    context?: AnnotationContext | undefined
    mode?: 'list' | 'peek' | undefined
    attachmentUrl?: ((attachment: ReviewAttachment) => string | null) | undefined
    onAttachment?: ((attachment: ReviewAttachment) => void) | null | undefined
    onInlineImage?: ((source: string, label: string) => void) | undefined
    onSelect?: ((node: TNode) => void) | undefined
    onEdit?: ((node: TNode) => void) | null | undefined
    renderEditIcon?: (() => Element) | undefined
    renderTitle?: ((title: string) => string) | undefined
    renderMarkdown: (value: string) => string
  }

  interface AnnotationListOptions<
    TNode extends RenderedAnnotationNode = RenderedAnnotationNode
  > extends Omit<
    AnnotationCreateOptions<TNode>,
    'node' | 'context' | 'mode'
  > {
    nodes: TNode[]
    selectedId: string | null
    context: (node: TNode) => AnnotationContext
  }

  interface AnnotationTreeNode {
    id: string
    children: AnnotationTreeNode[]
    feedback?: unknown
    attachments?: ReviewAttachment[]
  }

  interface AnnotationProjection<T extends AnnotationTreeNode = AnnotationTreeNode> {
    node: T
    children: AnnotationProjection<T>[]
    contextual: boolean
  }

  interface NavigationNode {
    id: string
    children: NavigationNode[]
  }

  interface NavigationContext {
    node: NavigationNode
    parent: NavigationNode
    index: number
  }

  type NavigationDirection = 'left' | 'right' | 'up' | 'down'
  type PaneLayoutPane = 'left' | 'center' | 'right'

  interface VerticalBounds {
    top: number
    bottom: number
  }

  type ReviewSessionStatus =
    | 'editing'
    | 'pending-agent'
    | 'agent-reviewing'
    | 'reviewed'
    | 'revised'
    | 'done'
    | 'handoff-in-progress'

  interface MarkoverBrandAssets {
    mark: string
    logotype: string
    lockup: string
  }

  interface MarkoverClipboardImage {
    bytes: Uint8Array
    mimeType: string
  }

  interface MarkoverDocument {
    reviewId?: string
    name: string | null
    path: string | null
    source: string
    checksum: string
    project?: ProjectIdentity | null
    projectEvidence?: ReviewProjectEvidence
    sourceState?: ReviewSourceState
    tree?: ReviewTree
  }

  interface MarkoverIncompatibleReview {
    kind: 'incompatible-review'
    reviewId: string
    format: string
    version: string
    compatibilityUrl: string
  }

  type MarkoverReviewListItem = MarkoverDocument | MarkoverIncompatibleReview

  interface ReviewStatusRequest {
    requestId: string
    reviewId: string
    status: ReviewSessionStatus
  }

  interface ReviewStatusResponse {
    requestId: string
    error?: string
  }

  interface ReviewSnapshotRequest {
    requestId: string
    reviewId: string
    purpose: 'handoff' | 'shutdown'
  }

  interface ReviewSnapshotResponse extends ReviewSnapshotRequest {
    tree?: ReviewTree | null
    error?: string
  }

  interface ReviewAutosaveStatus {
    failedReviewIds: string[]
  }

  type ManualReviewResolutionRequestOutcome =
    | 'reviewed-no-notes'
    | 'accepted-unreviewed'

  interface ReviewResolutionRequest {
    reviewIds: string[]
    outcome: ManualReviewResolutionRequestOutcome
  }

  interface ReviewResolutionResult {
    outcome: 'cancelled' | 'resolved'
    reviews: Array<{
      reviewId: string
      status: ReviewSessionStatus
      resolution?: ReviewResolution
    }>
  }

  interface ReviewUnresolveResult {
    reviewId: string
    status: 'editing'
  }

  interface ReviewResolutionSummaryBlock {
    nodeId: string
    title: string
    feedback: string
    attachments: string[]
    sourceEdit: { original: string; current: string } | null
  }

  interface ReviewResolutionSummary {
    reviewId: string
    documentName: string
    contextSummary: string
    blocks: ReviewResolutionSummaryBlock[]
  }

  interface ReviewResolutionConfirmationRequest {
    requestId: string
    outcome: ManualReviewResolutionRequestOutcome
    reviews: ReviewResolutionSummary[]
  }

  interface ReviewResolutionConfirmationResponse {
    requestId: string
    confirmed: boolean
  }

  interface ReviewTrashConfirmationRequest {
    requestId: string
    reviewId: string
    pendingAgent: boolean
  }

  interface ReviewTrashConfirmationResponse {
    requestId: string
    confirmed: boolean
  }

  type ReviewActivationOutcome =
    | 'activated'
    | 'already-active'
    | 'blocked'
    | 'deferred'
    | 'missing'

  interface ReviewActivationResult {
    reviewId: string
    outcome: ReviewActivationOutcome
  }

  interface ReviewActivationRequest {
    requestId: string
    reviewId: string
    document: MarkoverDocument | null
    focusState: MarkoverWindowFocusState
  }

  interface ReviewActivationResponse {
    requestId: string
    reviewId: string
    outcome?: ReviewActivationOutcome
    error?: string
  }

  interface MarkoverWindowFocusState {
    focused: boolean
    blurredAt: number | null
  }

  type CanonicalUpdateState =
    | 'hidden'
    | 'checking'
    | 'current'
    | 'available'
    | 'starting'
    | 'unavailable'

  interface CanonicalUpdatePullRequest {
    number: number
    title: string
  }

  interface CanonicalUpdateStatus {
    state: CanonicalUpdateState
    detail: string
    pullRequests: CanonicalUpdatePullRequest[]
  }

  interface CanonicalUpdateStartResult {
    status: 'accepted' | 'rejected'
    detail: string
  }

  type T3ThreadTitleStatus = 'disabled' | 'available' | 'unavailable'

  interface T3ThreadTitle {
    threadId: string
    title: string
  }

  interface T3ThreadTitleSnapshot {
    status: T3ThreadTitleStatus
    detail: string
    titles: T3ThreadTitle[]
  }

  type CodexThreadTitleStatus = 'disabled' | 'available' | 'unavailable'

  interface CodexThreadTitle {
    threadId: string
    title: string
  }

  interface CodexThreadTitleSnapshot {
    status: CodexThreadTitleStatus
    detail: string
    titles: CodexThreadTitle[]
  }

  type ClaudeThreadTitleStatus = 'disabled' | 'available' | 'unavailable'

  interface ClaudeThreadTitle {
    threadId: string
    title: string
  }

  interface ClaudeThreadTitleSnapshot {
    status: ClaudeThreadTitleStatus
    detail: string
    titles: ClaudeThreadTitle[]
  }

  interface MarkoverBridge {
    getStartupInfo: () => Promise<StartupInfo>
    reportStartupPhase: (event: StartupPhaseEvent) => Promise<void>
    reportRendererInitialized: (
      initialization: RendererInitialization
    ) => Promise<StartupReady>
    reportStartupFailure: (
      failure: RendererStartupFailure
    ) => Promise<RendererStartupFailureResult>
    copyStartupDiagnostic: () => Promise<void>
    revealStartupDiagnostic: () => Promise<void>
    quitStartup: () => void
    reportSmokeResult: (result: RendererSmokeResult) => Promise<void>
    getBrandAssets: () => Promise<MarkoverBrandAssets | null>
    openMarkdown: () => Promise<MarkoverDocument | null>
    createLocalReview: (tree: ReviewTree) => Promise<MarkoverDocument>
    onOpenMarkdownRequested: (callback: () => void) => void
    onReviewBatchModeRequested: (callback: () => void) => void
    onDevelopmentElementCallout: (
      callback: (
        command: DevelopmentElementCalloutCommand
      ) => DevelopmentElementCalloutResult | Promise<DevelopmentElementCalloutResult>
    ) => void
    checksum: (source: string) => Promise<string>
    copyText: (text: string) => void
    readClipboardImage: () => Promise<MarkoverClipboardImage | null>
    saveAttachment: (
      attachment: MarkoverClipboardImage,
      reviewId: string
    ) => Promise<ReviewAttachment>
    removeAttachment: (request: {
      reviewId: string
      attachmentId: string
      tree: ReviewTree
    }) => Promise<{
      reviewId: string
      attachmentId: string
      outcome: 'cancelled' | 'trashed'
    }>
    resolveReviews: (
      request: ReviewResolutionRequest
    ) => Promise<ReviewResolutionResult>
    unresolveReview: (reviewId: string) => Promise<ReviewUnresolveResult>
    getInitialReview: () => Promise<MarkoverDocument | null>
    getReviews: () => Promise<MarkoverReviewListItem[]>
    getT3ThreadTitles: () => Promise<T3ThreadTitleSnapshot>
    getCodexThreadTitles: () => Promise<CodexThreadTitleSnapshot>
    getClaudeThreadTitles: () => Promise<ClaudeThreadTitleSnapshot>
    getProjectFavicon: (reviewId: string) => Promise<string | null>
    openPullRequest: (reviewId: string) => Promise<void>
    openReviewContextMenu: (request: {
      reviewId: string
      x: number
      y: number
    }) => Promise<{
      outcome: 'copied' | 'copy-cancelled' | 'dismissed'
    }>
    onReviewOpened: (
      callback: (document: MarkoverDocument) => void | Promise<void>
    ) => void
    onReviewUpdated: (
      callback: (document: MarkoverDocument) => void | Promise<void>
    ) => void
    onReviewTrashed: (callback: (event: { reviewId: string }) => void) => void
    onReviewStatus: (
      callback: (status: ReviewStatusRequest) => void | Promise<void>
    ) => void
    onReviewSnapshotRequested: (
      callback: (
        request: ReviewSnapshotRequest
      ) => ReviewTree | null | Promise<ReviewTree | null>
    ) => void
    onReviewAutosaveStatus: (
      callback: (status: ReviewAutosaveStatus) => void
    ) => void
    onReviewResolutionConfirmation: (
      callback: (
        request: ReviewResolutionConfirmationRequest
      ) => boolean | Promise<boolean>
    ) => void
    onReviewTrashConfirmation: (
      callback: (
        request: ReviewTrashConfirmationRequest
      ) => boolean | Promise<boolean>
    ) => void
    getReviewAutosaveStatus: () => Promise<ReviewAutosaveStatus>
    onReviewShutdownState: (callback: (paused: boolean) => void) => void
    onReviewActivationRequested: (
      callback: (
        request: ReviewActivationRequest
      ) => ReviewActivationOutcome | Promise<ReviewActivationOutcome>
    ) => void
    activateReview: (reviewId: string) => void
    autosaveReview: (reviewId: string, tree: ReviewTree) => void
    getSettings: () => Promise<MarkoverSettingsEnvelope>
    updateSettings: (patch: unknown) => Promise<MarkoverSettingsEnvelope>
    getWorkspaceState: () => Promise<MarkoverWorkspaceState>
    updateWorkspaceState: (
      state: MarkoverWorkspaceState
    ) => Promise<MarkoverWorkspaceState>
    getWindowFocusState: () => Promise<MarkoverWindowFocusState>
    getCanonicalUpdateStatus: () => Promise<CanonicalUpdateStatus>
    startCanonicalUpdate: () => Promise<CanonicalUpdateStartResult>
    onWindowFocusChanged: (
      callback: (state: MarkoverWindowFocusState) => void
    ) => void
    onSettingsOpen: (callback: () => void) => void
    onSettingsChanged: (
      callback: (settings: MarkoverSettingsEnvelope) => void
    ) => void
  }

  interface ReviewSessionEnvelope {
    [key: string]: unknown
    id: string
    status: ReviewSessionStatus
    origin: string
    createdAt: string
    updatedAt: string
    attentionRequestedAt: string
    contextSummary: string
    agentThread: ReviewAgentThread | null
    git: ReviewGitSnapshot | null
    pullRequest: ReviewPullRequest | null
    resolution?: ReviewResolution
    agentGuidance: AgentGuidance
    agentReviewer?: ReviewAgentReviewer
  }

  type ReviewSessionTree = Omit<ReviewTree, 'review'> & {
    review: ReviewSessionEnvelope
  }

  interface ReviewSessionDocument {
    reviewId?: string
    name: string | null
    path?: string | null
    checksum: string
    tree: ReviewSessionTree
    project?: ProjectIdentity | null
    projectEvidence?: ReviewProjectEvidence
    sourceState?: ReviewSourceState
  }

  type ReviewProjectEvidence = 'verified' | 'conflict' | 'unavailable'

  type ReviewSourceState = 'unchanged' | 'changed' | 'missing' | 'unavailable'

  interface ProjectIdentity {
    key: string
    name: string
    root: string | null
  }

  interface ReviewSession {
    reviewId: string
    documentName: string
    documentPath: string | null
    checksum: string
    tree: ReviewSessionTree
    projectKey: string
    projectName: string
    projectRoot: string | null
    projectEvidence: ReviewProjectEvidence
    sourceState: ReviewSourceState
    attentionRequestedAt: number
    lifecycleActivityAt: number
    lastViewedOrder: number
    lastViewedAt: number
    selectedId: string | null
    annotatedOnly: boolean
    annotationView: 'selected' | 'list'
    sourceCollapsed: boolean
    collapsedBlockIds: Set<string>
    sourceDrafts: Map<string, string>
    sourceEditingId: string | null
    attachmentPreviewUrls: Map<string, string>
  }

  interface ReviewProjectGroup extends ProjectIdentity {
    lastViewedOrder: number
    sessions: ReviewSession[]
  }

  interface ReviewMutationTrackerContract {
    track<T>(reviewId: string, operation: T | PromiseLike<T>): Promise<T>
    has(reviewId: string): boolean
    waitCurrent(reviewId: string): Promise<void>
    wait(reviewId: string): Promise<void>
  }

  interface ReviewSessionsContract {
    add(document: ReviewSessionDocument): ReviewSession
    activate(reviewId: string): ReviewSession
    active(): ReviewSession | null
    get(reviewId: string): ReviewSession | null
    remove(reviewId: string): ReviewSession | null
    snapshot(reviewId: string): ReviewSessionTree | null
    updateStatus(
      reviewId: string,
      status: ReviewSessionEnvelope['status']
    ): ReviewSession | null
    updateDocument(document: ReviewSessionDocument): ReviewSession | null
    adjacent(reviewId: string, offset: number): ReviewSession | null
    list(): ReviewSession[]
    recent(limit?: number): ReviewSession[]
    projectGroups(): ReviewProjectGroup[]
  }

  interface MarkoverAnnotationBlockApi {
    model: (
      node: AnnotationModelNode,
      context?: AnnotationContext
    ) => AnnotationViewModel
    popoverPosition: (
      anchor: { left: number; right: number; top: number },
      popover: { width: number; height: number },
      viewport: { width: number; height: number },
      margin?: number
    ) => { x: number; y: number }
    create: <TNode extends RenderedAnnotationNode>(
      document: Document,
      options: AnnotationCreateOptions<TNode>
    ) => HTMLElement
    createList: <TNode extends RenderedAnnotationNode>(
      document: Document,
      options: AnnotationListOptions<TNode>
    ) => HTMLElement
    updateTruncation: (root: ParentNode) => void
    bindSneakPeek: <TNode extends AnnotationBlockNode>(
      marker: HTMLElement,
      node: TNode,
      handlers: {
        show: (node: TNode, marker: HTMLElement) => void
        hide: EventListener
      }
    ) => () => void
    bindDismiss: (
      target: EventTarget,
      eventName: string,
      hide: EventListener
    ) => () => void
    bindListKeyboard: (
      target: HTMLElement,
      handlers: { edit: () => void; move: (offset: -1 | 1) => void }
    ) => () => void
  }

  interface MarkoverAnnotationsApi {
    hasAnnotation: (node?: AnnotationTreeNode | null) => boolean
    annotatedNodes: <T extends AnnotationTreeNode>(root: T) => T[]
    annotatedProjection: <T extends AnnotationTreeNode>(
      root: T
    ) => AnnotationProjection<T>[]
    annotationPosition: (
      root: AnnotationTreeNode,
      id: string | null
    ) => { index: number; total: number }
    navigationRoot: (root: AnnotationTreeNode) => NavigationNode
    nearestAnnotatedId: (
      root: AnnotationTreeNode,
      currentId: string | null
    ) => string | null
    normalizeFilter: (
      root: AnnotationTreeNode,
      selectedId: string | null,
      enabled: boolean
    ) => { enabled: boolean; selectedId: string | null }
    revealAnnotation: (
      root: AnnotationTreeNode,
      id: string,
      collapsedBlockIds: Set<string>
    ) => boolean
  }

  interface MarkoverImagePreviewApi {
    labelFor: (image?: { id?: string; label?: string } | null) => string
    sourceLabel: (source: string, alt: string) => string
    sourceUrl: (source: string) => string | null
  }

  interface MarkoverNavigationApi {
    findContext: (
      root: NavigationNode,
      id: string | null
    ) => NavigationContext | null
    move: (
      root: NavigationNode,
      currentId: string | null,
      direction: NavigationDirection
    ) => string | null
    nextPane: (
      current: PaneLayoutPane,
      direction: -1 | 1,
      leftPaneVisible: boolean
    ) => PaneLayoutPane
    isOutsideViewport: (
      viewport: VerticalBounds,
      target: VerticalBounds
    ) => boolean
  }

  interface MarkoverReviewSessionsApi {
    clampRightPaneWidth: (
      width: unknown,
      paneLayoutWidth: unknown,
      leftPaneWidth: unknown
    ) => number
    clampLeftPaneWidth: (width: unknown, paneLayoutWidth: unknown) => number
    formatRelativeTime: (timestamp: unknown, now?: unknown) => string
    isTreeEditable: (tree: unknown) => boolean
    projectIdentity: (document: {
      path?: unknown
      project?: unknown
      reviewId?: unknown
      tree?: unknown
    }) => ProjectIdentity
    relativeTimeRefreshDelay: (
      timestamps: unknown[],
      now?: unknown
    ) => number | null
    ReviewMutationTracker: new () => ReviewMutationTrackerContract
    ReviewSessions: new (
      options?: { now?: () => number }
    ) => ReviewSessionsContract
  }

  interface Window {
    markover?: MarkoverBridge
    markoverStartup?: MarkoverStartupUi
  }
}
