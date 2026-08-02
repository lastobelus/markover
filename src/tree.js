(function exposeTree(globalScope) {
  const MarkdownIt = typeof require === 'function'
    ? require('markdown-it')
    : globalScope.markdownit
  const markdown = MarkdownIt('commonmark', {
    html: false,
    linkify: false,
    typographer: false
  })
  markdown.enable('table')

  function parseMarkdown(source, checksum = '', document = {}) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    const tokens = markdown.parse(source, {})
    let sequence = 0
    let listSequence = 0

    const root = {
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

    const tree = {
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

    const headingStack = []
    const listItemStack = []
    const listStack = []
    let currentSection = root
    let pendingHeading = null
    let pendingParagraph = null

    function createNode(properties) {
      sequence += 1
      return {
        id: `block-${sequence}`,
        feedback: '',
        collapsed: false,
        children: [],
        ...properties
      }
    }

    function addChild(parent, node) {
      parent.children.push(node)
    }

    function rawFromMap(map) {
      if (!map) return ''
      return lines.slice(map[0], map[1]).join('\n')
    }

    function addUnsupported(map) {
      if (!map) return
      for (let index = map[0]; index < map[1]; index += 1) {
        if (
          lines[index].trim() &&
          !tree.unsupported.some((entry) => entry.line === index + 1)
        ) {
          tree.unsupported.push({ line: index + 1, text: lines[index] })
        }
      }
    }

    function findClosingToken(startIndex, openType, closeType) {
      let depth = 0
      for (let index = startIndex; index < tokens.length; index += 1) {
        if (tokens[index].type === openType) depth += 1
        if (tokens[index].type === closeType) depth -= 1
        if (depth === 0) return index
      }
      return startIndex
    }

    function addMappedNode(type, token, properties = {}) {
      const parent = listItemStack.length
        ? listItemStack[listItemStack.length - 1]
        : currentSection
      const raw = rawFromMap(token.map)
      addChild(parent, createNode({
        type,
        text: raw,
        raw,
        lineStart: token.map[0] + 1,
        lineEnd: token.map[1],
        ...properties
      }))
    }

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex]

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
          map: token.map
        }
        continue
      }

      if (token.type === 'inline' && pendingHeading) {
        const { level, map } = pendingHeading
        while (
          headingStack.length &&
          headingStack[headingStack.length - 1].level >= level
        ) {
          headingStack.pop()
        }

        const parent = headingStack.length
          ? headingStack[headingStack.length - 1].node
          : root
        const node = createNode({
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
        pendingParagraph = { map: token.map }
        continue
      }

      if (token.type === 'inline' && pendingParagraph) {
        const { map } = pendingParagraph
        addChild(currentSection, createNode({
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
        listStack.push({
          id: `list-${listSequence}`,
          ordered,
          nextIndex: ordered ? Number(token.attrGet('start') || 1) : null,
          nodes: []
        })
        continue
      }

      if (token.type === 'ordered_list_close' || token.type === 'bullet_list_close') {
        const list = listStack.pop()
        for (const node of list.nodes) node.listLength = list.nodes.length
        continue
      }

      if (token.type === 'list_item_open') {
        const list = listStack[listStack.length - 1]
        const parent = listItemStack.length
          ? listItemStack[listItemStack.length - 1]
          : currentSection
        const marker = list.ordered ? `${list.nextIndex}.` : token.markup
        if (list.ordered) list.nextIndex += 1

        const node = createNode({
          type: list.ordered ? 'ordered-item' : 'unordered-item',
          marker,
          listId: list.id,
          listPosition: list.nodes.length + 1,
          listLength: null,
          text: '',
          raw: rawFromMap(token.map),
          lineStart: token.map[0] + 1,
          lineEnd: token.map[1]
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
        const node = listItemStack[listItemStack.length - 1]
        const firstInline = node.text === ''
        let text = token.content
        if (firstInline) {
          const task = text.match(/^\[([ xX])\]\s+([\s\S]*)$/)
          if (task) {
            node.task = true
            node.checked = task[1].toLowerCase() === 'x'
            text = task[2]
          }
        }
        node.text += `${firstInline ? '' : '\n\n'}${text}`
        if (firstInline) {
          node.raw = rawFromMap(token.map)
          node.lineEnd = token.map[1]
        }
        continue
      }

      if (token.type === 'fence' || token.type === 'code_block') {
        const parent = listItemStack.length
          ? listItemStack[listItemStack.length - 1]
          : currentSection
        addChild(parent, createNode({
          type: 'code',
          text: token.content.replace(/\n$/, ''),
          raw: rawFromMap(token.map),
          language: token.info.trim(),
          lineStart: token.map[0] + 1,
          lineEnd: token.map[1]
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

  function visitNodes(root, visitor, parent = null, ancestors = []) {
    for (const node of root.children) {
      visitor(node, parent, ancestors)
      visitNodes(node, visitor, node, [...ancestors, node])
    }
  }

  function findNode(root, id) {
    if (!root || !id) return null
    let match = null
    visitNodes(root, (node) => {
      if (node.id === id) match = node
    })
    return match
  }

  function nodePosition(root, id) {
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

  function serializeTree(tree) {
    return JSON.stringify(tree, null, 2)
  }

  const api = {
    findNode,
    nodePosition,
    parseMarkdown,
    serializeTree,
    visitNodes
  }
  globalScope.MarkoverTree = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
