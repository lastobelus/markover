import assert from 'node:assert/strict'
import test from 'node:test'

const {
  annotatedProjection,
  annotationPosition,
  navigationRoot,
  nearestAnnotatedId,
  normalizeFilter,
  revealAnnotation
} = require('../src/annotations') as MarkoverAnnotationsApi

function node(
  id: string,
  children: AnnotationTreeNode[] = [],
  feedback = '',
  attachments: ReviewAttachment[] = []
): AnnotationTreeNode {
  return { id, children, feedback, attachments }
}

function fixture(): AnnotationTreeNode {
  return node('document', [
    node('heading-a', [
      node('plain-a'),
      node('annotated-a', [], 'First comment.'),
      node('branch-a', [
        node('annotated-image', [], '', [{ id: 'img-1' }])
      ])
    ]),
    node('plain-root'),
    node('annotated-b', [], 'Second comment.')
  ])
}

test('projects annotations with only their ancestor context', () => {
  const root = fixture()
  const heading = root.children[0]
  assert.ok(heading)
  heading.collapsed = true
  const projection = annotatedProjection(root)
  assert.deepEqual(
    projection.map((entry) => ({
      id: entry.node.id,
      contextual: entry.contextual,
      children: entry.children.map((child) => child.node.id)
    })),
    [
      {
        id: 'heading-a',
        contextual: true,
        children: ['annotated-a', 'branch-a']
      },
      { id: 'annotated-b', contextual: false, children: [] }
    ]
  )
  const firstProjection = projection[0]
  const branchProjection = firstProjection?.children[1]
  const imageProjection = branchProjection?.children[0]
  assert.ok(branchProjection)
  assert.ok(imageProjection)
  assert.equal(branchProjection.contextual, true)
  assert.equal(imageProjection.node.id, 'annotated-image')
})

test('builds structural navigation from the filtered projection', () => {
  assert.deepEqual(navigationRoot(fixture()), {
    id: 'document',
    children: [
      {
        id: 'heading-a',
        children: [
          { id: 'annotated-a', children: [] },
          {
            id: 'branch-a',
            children: [{ id: 'annotated-image', children: [] }]
          }
        ]
      },
      { id: 'annotated-b', children: [] }
    ]
  })
})

test('moves hidden selection to the nearest annotation with forward tie break', () => {
  const root = fixture()
  assert.equal(nearestAnnotatedId(root, 'plain-a'), 'annotated-a')
  assert.equal(nearestAnnotatedId(root, 'plain-root'), 'annotated-b')
  assert.equal(nearestAnnotatedId(root, 'annotated-a'), 'annotated-a')
  assert.deepEqual(annotationPosition(root, 'annotated-image'), {
    index: 2,
    total: 3
  })
})

test('normalizes selection only when it is absent from the filtered projection', () => {
  const root = fixture()
  assert.deepEqual(normalizeFilter(root, 'heading-a', true), {
    enabled: true,
    selectedId: 'heading-a'
  })
  assert.deepEqual(normalizeFilter(root, 'plain-a', true), {
    enabled: true,
    selectedId: 'annotated-a'
  })
  assert.deepEqual(normalizeFilter(root, 'plain-a', false), {
    enabled: false,
    selectedId: 'plain-a'
  })
})

test('normalizes annotation removals including attachment-only annotations', () => {
  const root = fixture()
  const heading = root.children[0]
  const finalAnnotation = root.children[2]
  assert.ok(heading)
  assert.ok(finalAnnotation)
  const textAnnotation = heading.children[1]
  const branch = heading.children[2]
  assert.ok(textAnnotation)
  assert.ok(branch)
  const attachmentAnnotation = branch.children[0]
  assert.ok(attachmentAnnotation)

  textAnnotation.feedback = ''
  assert.deepEqual(normalizeFilter(root, textAnnotation.id, true), {
    enabled: true,
    selectedId: attachmentAnnotation.id
  })

  attachmentAnnotation.attachments = []
  assert.deepEqual(normalizeFilter(root, attachmentAnnotation.id, true), {
    enabled: true,
    selectedId: finalAnnotation.id
  })

  finalAnnotation.feedback = ''
  assert.deepEqual(normalizeFilter(root, finalAnnotation.id, true), {
    enabled: false,
    selectedId: finalAnnotation.id
  })
})

test('reveals a selected annotation without changing unrelated collapse state', () => {
  const root = fixture()
  const heading = root.children[0]
  assert.ok(heading)
  const branch = heading.children[2]
  const unrelated = root.children[2]
  assert.ok(branch)
  assert.ok(unrelated)
  heading.collapsed = true
  branch.collapsed = true
  unrelated.collapsed = true

  assert.equal(revealAnnotation(root, 'annotated-image'), true)
  assert.equal(heading.collapsed, false)
  assert.equal(branch.collapsed, false)
  assert.equal(unrelated.collapsed, true)
  assert.equal(revealAnnotation(root, 'annotated-image'), false)
})

test('reveals an unannotated selected block hidden by collapsed ancestors', () => {
  const root = fixture()
  const heading = root.children[0]
  assert.ok(heading)
  const branch = heading.children[2]
  assert.ok(branch)
  const selected = node('plain-nested')
  branch.children.push(selected)
  heading.collapsed = true
  branch.collapsed = true

  assert.equal(revealAnnotation(root, selected.id), true)
  assert.equal(heading.collapsed, false)
  assert.equal(branch.collapsed, false)
})
