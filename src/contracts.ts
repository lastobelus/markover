import type {
  FileTree,
  FileTreeDirectoryHandle,
  FileTreeIcons,
  FileTreeItemHandle,
  FileTreeSortEntry,
  RemappedIcon
} from '@pierre/trees' with { 'resolution-mode': 'import' }

export interface DiffStats {
  additions: number
  deletions: number
}

export interface DiffRenderer {
  render(
    container: HTMLElement,
    original: string,
    current: string,
    key?: string
  ): () => void
  stats(original: string, current: string): DiffStats
}

declare global {
  type MarkoverDiffStats = DiffStats
  type MarkoverFileTreeConstructor = typeof FileTree
  type MarkoverFileTreeDirectoryHandle = FileTreeDirectoryHandle
  type MarkoverFileTreeIcons = FileTreeIcons
  type MarkoverFileTreeItemHandle = FileTreeItemHandle
  type MarkoverFileTreeSortEntry = FileTreeSortEntry
  type MarkoverRemappedIcon = RemappedIcon

  type Palette = 'ember' | 'ocean' | 'olive'
  type Appearance = 'system' | 'light' | 'dark'
  type ResolvedAppearance = 'light' | 'dark'
  type TreeDensity = 'comfortable' | 'compact'
  type AnnotationTextSize = 'small' | 'medium' | 'large'
  type DefaultTreeView = 'all' | 'annotated'
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
    showKeyboardHelp: boolean
    openDocumentsSidebar: boolean
    defaultTreeView: DefaultTreeView
    confirmAttachmentRemoval: boolean
    discoverAgentThreadFromLocalSessions: boolean
    logRejectedApiRequests: boolean
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

  interface MarkoverSettingsApi {
    DEFAULT_SETTINGS: Readonly<MarkoverSettings>
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
      defaultTreeView: readonly DefaultTreeView[]
    }>
    normalizeSettings: (value?: unknown) => MarkoverSettings
    updateSettings: (current: unknown, patch: unknown) => MarkoverSettings
    windowBackground: (
      settings: unknown,
      resolvedAppearance?: string
    ) => string
    applySettingsToView: (
      settings: unknown,
      view: SettingsView
    ) => AppliedSettings
    darkColorization: (palette: unknown) => DarkColorization
    sidebarPreferenceChanged: (
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
    collapsed: boolean
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
    collapsed?: boolean
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
  type WorkspacePane = 'documents' | 'preview' | 'annotation'

  interface VerticalBounds {
    top: number
    bottom: number
  }

  type ReviewSessionStatus =
    | 'editing'
    | 'pending-agent'
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
    projectRoot?: unknown
    tree?: ReviewTree
    durable?: boolean
    autosavePath?: string | null
  }

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
  }

  interface ReviewSnapshotResponse extends ReviewSnapshotRequest {
    tree?: ReviewTree | null
    error?: string
  }

  interface MarkoverBridge {
    getBrandAssets: () => Promise<MarkoverBrandAssets | null>
    openMarkdown: () => Promise<MarkoverDocument | null>
    onOpenMarkdownRequested: (callback: () => void) => void
    checksum: (source: string) => Promise<string>
    copyText: (text: string) => void
    readClipboardImage: () => Promise<MarkoverClipboardImage | null>
    saveAttachment: (
      attachment: MarkoverClipboardImage,
      reviewId?: string | null
    ) => Promise<ReviewAttachment>
    getInitialReview: () => Promise<MarkoverDocument | null>
    getReviews: () => Promise<MarkoverDocument[]>
    onReviewOpened: (
      callback: (document: MarkoverDocument) => void | Promise<void>
    ) => void
    onReviewStatus: (
      callback: (status: ReviewStatusRequest) => void | Promise<void>
    ) => void
    onReviewSnapshotRequested: (
      callback: (
        reviewId: string
      ) => ReviewTree | null | Promise<ReviewTree | null>
    ) => void
    activateReview: (reviewId: string) => void
    autosaveReview: (reviewId: string | null, tree: ReviewTree) => void
    finishReview: (tree: ReviewTree) => void
    cancelReview: () => void
    getSettings: () => Promise<MarkoverSettingsEnvelope>
    updateSettings: (patch: unknown) => Promise<MarkoverSettingsEnvelope>
    onSettingsOpen: (callback: () => void) => void
    onSettingsChanged: (
      callback: (settings: MarkoverSettingsEnvelope) => void
    ) => void
  }

  interface ReviewSessionEnvelope {
    id: string
    status: ReviewSessionStatus
    createdAt?: string
    updatedAt?: string
    contextSummary?: string
    agentThread?: unknown
    git?: unknown
    pullRequest?: unknown
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
    projectRoot?: string | null
  }

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
    lastViewedOrder: number
    lastViewedAt: number
    selectedId: string | null
    annotatedOnly: boolean
    annotationView: 'selected' | 'list'
    sourceCollapsed: boolean
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
    wait(reviewId: string): Promise<void>
  }

  interface ReviewSessionsContract {
    add(document: ReviewSessionDocument): ReviewSession
    activate(reviewId: string): ReviewSession
    active(): ReviewSession | null
    get(reviewId: string): ReviewSession | null
    snapshot(reviewId: string): ReviewSessionTree | null
    updateStatus(
      reviewId: string,
      status: ReviewSessionEnvelope['status']
    ): ReviewSession | null
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
    revealAnnotation: (root: AnnotationTreeNode, id: string) => boolean
  }

  interface MarkoverImagePreviewApi {
    fileUrl: (filePath?: string | null) => string | null
    labelFor: (image?: { id?: string; label?: string } | null) => string
    sourceLabel: (source: string, alt: string) => string
    sourceUrl: (
      source: string,
      documentPath?: string | null
    ) => string | null
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
      current: WorkspacePane,
      direction: -1 | 1,
      documentsVisible: boolean
    ) => WorkspacePane
    isOutsideViewport: (
      viewport: VerticalBounds,
      target: VerticalBounds
    ) => boolean
  }

  interface MarkoverReviewSessionsApi {
    clampDocumentsListWidth: (width: unknown, viewportWidth: unknown) => number
    formatRelativeTime: (timestamp: unknown, now?: unknown) => string
    isTreeEditable: (tree: unknown) => boolean
    projectIdentity: (document: {
      path?: unknown
      projectRoot?: unknown
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
  }
}
