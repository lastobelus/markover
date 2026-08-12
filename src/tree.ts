import MarkdownIt from 'markdown-it'
import * as YAML from 'yaml'

  type LineMap = [number, number]
  interface MarkdownToken {
    type: string
    tag: string
    map: LineMap | null
    content: string
    info: string
    markup: string
    nesting: number
    attrGet(name: string): string | null
  }
  interface FrontmatterEntry {
    key: string
    raw: string
    lineStart: number
    lineEnd: number
  }
  interface ParsedFrontmatter {
    closingIndex: number
    entries: FrontmatterEntry[]
  }
  interface HeadingContext {
    level: number
    node: HeadingNode
  }
  type ListContext = {
    id: string
    nodes: Array<OrderedItemNode | UnorderedItemNode>
  } & (
    | { ordered: true; nextIndex: number }
    | { ordered: false; nextIndex: null }
  )
  type NodeDefaults = 'id' | 'feedback' | 'collapsed' | 'children'
  type NewNode<T extends ReviewNode> = Omit<T, NodeDefaults> &
    Partial<Pick<T, 'children'>> & { collapsed?: boolean }

  const markdown = MarkdownIt('commonmark', {
    html: false,
    linkify: false,
    typographer: false
  })
  markdown.enable('table')

  function yamlDiagnostic(source: string): YamlDiagnostic | null {
    const document = YAML.parseDocument(source, { prettyErrors: true })
    const error = document.errors[0]
    if (error) {
      const start = error.linePos?.[0]
      return {
        line: start?.line || null,
        column: start?.col || null,
        message: error.message.trim()
      }
    }

    const contents = document.contents
    if (YAML.isMap(contents) && contents.items.length) {
      return null
    }

    return {
      line: 1,
      column: 1,
      message: 'Expected one or more YAML key: value pairs.'
    }
  }

  function parseFrontmatter(lines: string[]): ParsedFrontmatter | null {
    if (!/^\uFEFF?---\s*$/.test(lines[0] || '')) return null

    const closingIndex = lines.findIndex((line, index) => (
      index > 0 && /^(?:---|\.\.\.)\s*$/.test(line)
    ))
    if (closingIndex === -1) return null

    const source = lines.slice(1, closingIndex).join('\n')
    const document = YAML.parseDocument(source, { prettyErrors: false })
    const contents = document.contents
    if (document.errors.length || (contents && !YAML.isMap(contents))) {
      return null
    }

    const entries = (contents?.items || []).map((pair) => {
      // `yaml` can emit a null key although its Pair declaration excludes it.
      const keyRange = (
        pair as unknown as {
          key?: { range?: [number, number, number] } | null
        }
      ).key?.range
      if (!keyRange || keyRange[0] === keyRange[1]) return null
      const keyStart = keyRange[0]
      const valueEnd = pair.value ? pair.value.range[2] : keyRange[2]
      if (!Number.isInteger(keyStart) || !Number.isInteger(valueEnd)) return null

      const start = source.lastIndexOf('\n', keyStart - 1) + 1
      if (source.slice(start, keyStart).trim()) return null

      const rangeEnd = source[valueEnd - 1] === '\n'
        ? valueEnd - 1
        : valueEnd
      const nextBreak = source.indexOf('\n', rangeEnd)
      const end = nextBreak === -1 ? source.length : nextBreak
      if (source.slice(rangeEnd, end).trim()) return null

      const raw = source.slice(start, end)
      const linesBefore = source.slice(0, start).split('\n').length - 1
      return {
        key: source.slice(keyRange[0], keyRange[1]),
        raw,
        lineStart: linesBefore + 2,
        lineEnd: linesBefore + 1 + raw.split('\n').length
      }
    }).filter((entry): entry is FrontmatterEntry => entry !== null)

    return { closingIndex, entries }
  }

  function parseMarkdown(
    source: string,
    checksum = '',
    document: ReviewDocumentInput = {}
  ): ReviewTree {
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    const frontmatter = parseFrontmatter(lines)
    const markdownSource = frontmatter
      ? lines.map((line, index) => (
        index <= frontmatter.closingIndex ? '' : line
      )).join('\n')
      : source
    const tokens = markdown.parse(markdownSource, {})
    let sequence = 0
    let listSequence = 0

    const root: DocumentNode = {
      id: 'document',
      type: 'document',
      text: 'Document',
      raw: source,
      lineStart: 1,
      lineEnd: lines.length,
      feedback: '',
      collapsed: false,
      children: []
    }

    const tree: ReviewTree = {
      format: 'markover-review',
      version: 1,
      sourceDocument: {
        name: document.name || null,
        path: document.path || null,
        content: source,
        checksum
      },
      unsupported: [],
      root
    }

    const headingStack: HeadingContext[] = []
    const listItemStack: Array<OrderedItemNode | UnorderedItemNode> = []
    const listStack: ListContext[] = []
    let currentSection: ReviewNode = root
    let pendingHeading: { level: number; map: LineMap } | null = null
    let pendingParagraph: { map: LineMap } | null = null

    function createNode<T extends ReviewNode>(properties: NewNode<T>): T {
      sequence += 1
      return {
        id: `block-${String(sequence)}`,
        feedback: '',
        collapsed: false,
        children: [],
        ...properties
      } as unknown as T
    }

    function addChild(parent: ReviewNode, node: ReviewNode): void {
      parent.children.push(node)
    }

    function rawFromMap(map: LineMap | null): string {
      if (!map) return ''
      return lines.slice(map[0], map[1]).join('\n')
    }

    function addUnsupported(map: LineMap | null): void {
      if (!map) return
      for (let index = map[0]; index < map[1]; index += 1) {
        const line = lines[index] as string
        if (
          line.trim() &&
          !tree.unsupported.some((entry) => entry.line === index + 1)
        ) {
          tree.unsupported.push({ line: index + 1, text: line })
        }
      }
    }

    function findClosingToken(
      startIndex: number,
      openType: string,
      closeType: string
    ): number {
      let depth = 0
      for (let index = startIndex; index < tokens.length; index += 1) {
        const token = tokens[index] as MarkdownToken
        if (token.type === openType) depth += 1
        if (token.type === closeType) depth -= 1
        if (depth === 0) return index
      }
      return startIndex
    }

    function addMappedNode(
      type: 'blockquote' | 'table' | 'thematic-break',
      token: MarkdownToken
    ): void {
      const parent = listItemStack.length
        ? listItemStack[listItemStack.length - 1] as ReviewNode
        : currentSection
      const map = token.map as LineMap
      const raw = rawFromMap(map)
      addChild(parent, createNode<BlockquoteNode | TableNode | ThematicBreakNode>({
        type,
        text: raw,
        raw,
        lineStart: map[0] + 1,
        lineEnd: map[1]
      }))
    }

    if (frontmatter) {
      const parent = createNode<FrontmatterNode>({
        type: 'frontmatter',
        text: 'YAML Frontmatter',
        raw: lines.slice(0, frontmatter.closingIndex + 1).join('\n'),
        lineStart: 1,
        lineEnd: frontmatter.closingIndex + 1,
        collapsed: true,
        sourceEditable: false
      })
      for (const entry of frontmatter.entries) {
        addChild(parent, createNode<FrontmatterEntryNode>({
          type: 'frontmatter-entry',
          text: entry.raw,
          raw: entry.raw,
          key: entry.key,
          lineStart: entry.lineStart,
          lineEnd: entry.lineEnd
        }))
      }
      addChild(root, parent)
    }

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex] as MarkdownToken

      if (token.type === 'blockquote_open') {
        addMappedNode('blockquote', token)
        tokenIndex = findClosingToken(
          tokenIndex,
          'blockquote_open',
          'blockquote_close'
        )
        continue
      }

      if (token.type === 'table_open') {
        addMappedNode('table', token)
        tokenIndex = findClosingToken(tokenIndex, 'table_open', 'table_close')
        continue
      }

      if (token.type === 'heading_open') {
        pendingHeading = {
          level: Number(token.tag.slice(1)),
          map: token.map as LineMap
        }
        continue
      }

      if (token.type === 'inline' && pendingHeading) {
        const { level, map } = pendingHeading
        while (
          headingStack.length &&
          (headingStack[headingStack.length - 1] as HeadingContext).level >= level
        ) {
          headingStack.pop()
        }

        const parent = headingStack.length
          ? (headingStack[headingStack.length - 1] as HeadingContext).node
          : root
        const node = createNode<HeadingNode>({
          type: 'heading',
          level,
          text: token.content,
          raw: rawFromMap(map),
          lineStart: map[0] + 1,
          lineEnd: map[1]
        })

        addChild(parent, node)
        headingStack.push({ level, node })
        currentSection = node
        pendingHeading = null
        continue
      }

      if (token.type === 'paragraph_open' && !listItemStack.length) {
        pendingParagraph = { map: token.map as LineMap }
        continue
      }

      if (token.type === 'inline' && pendingParagraph) {
        const { map } = pendingParagraph
        addChild(currentSection, createNode<ParagraphNode>({
          type: 'paragraph',
          text: token.content,
          raw: rawFromMap(map),
          lineStart: map[0] + 1,
          lineEnd: map[1]
        }))
        pendingParagraph = null
        continue
      }

      if (token.type === 'paragraph_close') {
        pendingParagraph = null
        continue
      }

      if (token.type === 'ordered_list_open' || token.type === 'bullet_list_open') {
        const ordered = token.type === 'ordered_list_open'
        listSequence += 1
        const id = `list-${String(listSequence)}`
        listStack.push(ordered
          ? {
              id,
              ordered: true,
              nextIndex: Number(token.attrGet('start') || 1),
              nodes: []
            }
          : { id, ordered: false, nextIndex: null, nodes: [] })
        continue
      }

      if (token.type === 'ordered_list_close' || token.type === 'bullet_list_close') {
        const list = listStack.pop() as ListContext
        for (const node of list.nodes) node.listLength = list.nodes.length
        continue
      }

      if (token.type === 'list_item_open') {
        const list = listStack[listStack.length - 1] as ListContext
        const parent = listItemStack.length
          ? listItemStack[listItemStack.length - 1] as ReviewNode
          : currentSection
        const marker = list.ordered
          ? `${String(list.nextIndex)}.`
          : token.markup
        if (list.ordered) list.nextIndex += 1
        const map = token.map as LineMap

        const node = createNode<OrderedItemNode | UnorderedItemNode>({
          type: list.ordered ? 'ordered-item' : 'unordered-item',
          marker,
          listId: list.id,
          listPosition: list.nodes.length + 1,
          listLength: null,
          text: '',
          raw: rawFromMap(map),
          lineStart: map[0] + 1,
          lineEnd: map[1]
        })

        addChild(parent, node)
        list.nodes.push(node)
        listItemStack.push(node)
        continue
      }

      if (token.type === 'list_item_close') {
        listItemStack.pop()
        continue
      }

      if (token.type === 'inline' && listItemStack.length) {
        const node = listItemStack[
          listItemStack.length - 1
        ] as OrderedItemNode | UnorderedItemNode
        const firstInline = node.text === ''
        let text = token.content
        if (firstInline) {
          const task = text.match(/^\[([ xX])\]\s+([\s\S]*)$/)
          if (task) {
            node.task = true
            node.checked = (task[1] as string).toLowerCase() === 'x'
            text = task[2] as string
          }
        }
        node.text += `${firstInline ? '' : '\n\n'}${text}`
        if (firstInline) {
          const map = token.map as LineMap
          node.raw = rawFromMap(map)
          node.lineEnd = map[1]
        }
        continue
      }

      if (token.type === 'fence' || token.type === 'code_block') {
        const parent = listItemStack.length
          ? listItemStack[listItemStack.length - 1] as ReviewNode
          : currentSection
        const map = token.map as LineMap
        addChild(parent, createNode<CodeNode>({
          type: 'code',
          text: token.content.replace(/\n$/, ''),
          raw: rawFromMap(map),
          language: token.info.trim(),
          lineStart: map[0] + 1,
          lineEnd: map[1]
        }))
        continue
      }

      if (token.type === 'hr') {
        addMappedNode('thematic-break', token)
        continue
      }

      if (token.map && token.nesting === 0) {
        addUnsupported(token.map)
      }
    }

    return tree
  }

  function visitNodes(
    root: ReviewNode,
    visitor: ReviewNodeVisitor,
    parent: ReviewNode | null = null,
    ancestors: ReviewNode[] = []
  ): void {
    for (const node of root.children) {
      visitor(node, parent, ancestors)
      visitNodes(node, visitor, node, [...ancestors, node])
    }
  }

  function findNode(
    root: ReviewNode | null | undefined,
    id: string | null | undefined
  ): ReviewNode | null {
    if (!root || !id) return null
    let match: ReviewNode | null = null
    visitNodes(root, (node) => {
      if (node.id === id) match = node
    })
    return match
  }

  function nodePosition(
    root: ReviewNode,
    id: string
  ): { index: number; total: number } {
    let index = 0
    let selectedIndex = 0
    visitNodes(root, (node) => {
      index += 1
      if (node.id === id) selectedIndex = index
    })
    return {
      index: selectedIndex,
      total: index
    }
  }

  function serializeTree(tree: ReviewTree): string {
    return JSON.stringify(tree, null, 2)
  }

  const api = {
    findNode,
    nodePosition,
    parseMarkdown,
    serializeTree,
    visitNodes,
    yamlDiagnostic
  } satisfies MarkoverTreeApi

export {
  findNode,
  nodePosition,
  parseMarkdown,
  serializeTree,
  visitNodes,
  yamlDiagnostic
}
export default api
