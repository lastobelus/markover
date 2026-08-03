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
    label?: string
    path?: string
    mimeType?: string
    url?: string
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

  var MarkoverDiffs: DiffRenderer
  var MarkoverSettings: MarkoverSettingsApi
  var MarkoverSourceEdits: MarkoverSourceEditsApi
  var MarkoverTree: MarkoverTreeApi
}
