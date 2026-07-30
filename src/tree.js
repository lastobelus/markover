(function exposeTree(globalScope) {
  const headingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
  const listPattern = /^([ \t]*)([-+*]|\d+[.)])[ \t]+(.+)$/
  const fencePattern = /^([ \t]*)(`{3,}|~{3,})(.*)$/

  function indentationWidth(value) {
    let width = 0
    for (const character of value) {
      width += character === '\t' ? 4 : 1
    }
    return width
  }

  function parseMarkdown(source, checksum = '') {
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    let sequence = 0

    const root = {
      id: 'document',
      type: 'document',
      text: 'Document',
      raw: source,
      lineStart: 1,
      lineEnd: lines.length,
      annotation: '',
      collapsed: false,
      children: []
    }

    const tree = {
      format: 'markover-tree',
      version: 1,
      checksum,
      source,
      unsupported: [],
      root
    }

    const headingStack = []
    const listStack = []
    let currentSection = root

    function createNode(properties) {
      sequence += 1
      return {
        id: `block-${sequence}`,
        annotation: '',
        collapsed: false,
        children: [],
        ...properties
      }
    }

    function addChild(parent, node) {
      parent.children.push(node)
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const lineNumber = index + 1
      const fenceMatch = line.match(fencePattern)

      if (fenceMatch) {
        const markerCharacter = fenceMatch[2][0]
        const minimumLength = fenceMatch[2].length
        const closingPattern = new RegExp(
          `^[ \\t]*${markerCharacter === '`' ? '`' : '~'}{${minimumLength},}[ \\t]*$`
        )
        const codeLines = []
        let endIndex = index

        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
          endIndex = cursor
          if (closingPattern.test(lines[cursor])) break
          codeLines.push(lines[cursor])
        }

        const isClosed = endIndex > index && closingPattern.test(lines[endIndex])
        if (!isClosed) endIndex = lines.length - 1

        const indent = indentationWidth(fenceMatch[1])
        while (listStack.length && indent <= listStack[listStack.length - 1].indent) {
          listStack.pop()
        }
        const parent = listStack.length
          ? listStack[listStack.length - 1].node
          : currentSection

        addChild(parent, createNode({
          type: 'code',
          text: codeLines.join('\n'),
          raw: lines.slice(index, endIndex + 1).join('\n'),
          language: fenceMatch[3].trim(),
          lineStart: lineNumber,
          lineEnd: endIndex + 1
        }))

        index = endIndex
        continue
      }

      const headingMatch = line.match(headingPattern)
      if (headingMatch) {
        const level = headingMatch[1].length
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
          text: headingMatch[2],
          raw: line,
          lineStart: lineNumber,
          lineEnd: lineNumber
        })

        addChild(parent, node)
        headingStack.push({ level, node })
        currentSection = node
        listStack.length = 0
        continue
      }

      const listMatch = line.match(listPattern)
      if (listMatch) {
        const indent = indentationWidth(listMatch[1])
        while (listStack.length && indent <= listStack[listStack.length - 1].indent) {
          listStack.pop()
        }

        const parent = listStack.length
          ? listStack[listStack.length - 1].node
          : currentSection
        const ordered = /^\d/.test(listMatch[2])
        const node = createNode({
          type: ordered ? 'ordered-item' : 'unordered-item',
          marker: listMatch[2],
          text: listMatch[3],
          raw: line,
          lineStart: lineNumber,
          lineEnd: lineNumber
        })

        addChild(parent, node)
        listStack.push({ indent, node })
        continue
      }

      if (line.trim() === '') continue

      listStack.length = 0
      tree.unsupported.push({ line: lineNumber, text: line })
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

  function serializeTree(tree) {
    return JSON.stringify(tree, null, 2)
  }

  const api = { findNode, parseMarkdown, serializeTree, visitNodes }
  globalScope.MarkoverTree = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
