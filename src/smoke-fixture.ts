export function smokeReviewTree(): ReviewTree {
  const source = [
    '---',
    'title: Smoke',
    '---',
    '# Renderer smoke',
    '',
    'Bundled Markdown renders here.',
    ''
  ].join('\n')
  return {
    format: 'markover-review',
    version: 1,
    sourceDocument: {
      name: 'smoke.md',
      path: '/markover-smoke/smoke.md',
      content: source,
      checksum: 'sha256:markover-smoke-fixture'
    },
    unsupported: [],
    root: {
      id: 'document',
      type: 'document',
      text: 'Document',
      raw: source,
      lineStart: 1,
      lineEnd: 7,
      feedback: '',
      collapsed: false,
      children: [
        {
          id: 'smoke-yaml',
          type: 'frontmatter',
          text: 'YAML frontmatter',
          raw: '---\ntitle: Smoke\n---',
          lineStart: 1,
          lineEnd: 3,
          feedback: '',
          collapsed: false,
          sourceEditable: false,
          children: [{
            id: 'smoke-yaml-title',
            type: 'frontmatter-entry',
            key: 'title',
            text: 'title: Smoke',
            raw: 'title: Smoke',
            lineStart: 2,
            lineEnd: 2,
            feedback: '',
            collapsed: false,
            children: []
          }]
        },
        {
          id: 'smoke-heading',
          type: 'heading',
          level: 1,
          text: 'Renderer smoke',
          raw: '# Renderer smoke',
          lineStart: 4,
          lineEnd: 4,
          feedback: '',
          collapsed: false,
          children: [],
          sourceEdit: {
            original: '# Renderer smoke',
            current: '# Renderer smoke verified'
          }
        },
        {
          id: 'smoke-paragraph',
          type: 'paragraph',
          text: 'Bundled Markdown renders here.',
          raw: 'Bundled Markdown renders here.',
          lineStart: 6,
          lineEnd: 6,
          feedback: '',
          collapsed: false,
          children: []
        }
      ]
    }
  }
}
