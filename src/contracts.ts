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
  type Palette = 'ember' | 'ocean' | 'olive'
  type Appearance = 'system' | 'light' | 'dark'
  type ResolvedAppearance = 'light' | 'dark'
  type TreeDensity = 'comfortable' | 'compact'
  type AnnotationTextSize = 'small' | 'medium' | 'large'
  type DefaultTreeView = 'all' | 'annotated'
  type DarkColorization = 'high' | 'mid' | 'low'

  interface MarkoverSettings {
    palette: Palette
    appearance: Appearance
    treeDensity: TreeDensity
    annotationTextSize: AnnotationTextSize
    showKeyboardHelp: boolean
    openDocumentsSidebar: boolean
    defaultTreeView: DefaultTreeView
    confirmAttachmentRemoval: boolean
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

  type RenderedAnnotationNode = AnnotationModelNode & { id: string }

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

  interface AnnotationCreateOptions {
    node: RenderedAnnotationNode
    context?: AnnotationContext | undefined
    mode?: 'list' | 'peek' | undefined
    attachmentUrl?: ((attachment: ReviewAttachment) => string | null) | undefined
    onAttachment?: ((attachment: ReviewAttachment) => void) | null | undefined
    onInlineImage?: ((source: string, label: string) => void) | undefined
    onSelect?: ((node: RenderedAnnotationNode) => void) | undefined
    onEdit?: ((node: RenderedAnnotationNode) => void) | null | undefined
    renderTitle?: ((title: string) => string) | undefined
    renderMarkdown: (value: string) => string
  }

  interface AnnotationListOptions extends
    Omit<AnnotationCreateOptions, 'node' | 'context' | 'mode'> {
    nodes: RenderedAnnotationNode[]
    selectedId: string | null
    context: (node: RenderedAnnotationNode) => AnnotationContext
  }

  interface AnnotationTreeNode {
    id: string
    children: AnnotationTreeNode[]
    feedback?: unknown
    attachments?: ReviewAttachment[]
    collapsed?: boolean
  }

  interface AnnotationProjection {
    node: AnnotationTreeNode
    children: AnnotationProjection[]
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
    name: string
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
    create: (
      document: Document,
      options: AnnotationCreateOptions
    ) => HTMLElement
    createList: (
      document: Document,
      options: AnnotationListOptions
    ) => HTMLElement
    updateTruncation: (root: ParentNode) => void
    bindSneakPeek: (
      marker: HTMLElement,
      node: AnnotationBlockNode,
      handlers: {
        show: (node: AnnotationBlockNode, marker: HTMLElement) => void
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
    annotatedNodes: (root: AnnotationTreeNode) => AnnotationTreeNode[]
    annotatedProjection: (root: AnnotationTreeNode) => AnnotationProjection[]
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
      id: string
    ) => NavigationContext | null
    move: (
      root: NavigationNode,
      currentId: string,
      direction: NavigationDirection
    ) => string
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

  var MarkoverAnnotationBlock: MarkoverAnnotationBlockApi
  var MarkoverAnnotations: MarkoverAnnotationsApi
  var MarkoverDiffs: DiffRenderer
  var MarkoverImagePreview: MarkoverImagePreviewApi
  var MarkoverNavigation: MarkoverNavigationApi
  var MarkoverReviewSessions: MarkoverReviewSessionsApi
  var MarkoverSettings: MarkoverSettingsApi
  var MarkoverSourceEdits: MarkoverSourceEditsApi
  var MarkoverTree: MarkoverTreeApi
}
