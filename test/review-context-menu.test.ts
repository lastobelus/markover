import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  isReviewContextMenuKey,
  keyboardContextMenuPoint,
  nativeContextMenuPoint,
  pointerContextMenuPoint,
  reviewContextMenuFocusKey
} from '../src/review-context-menu'

const root = path.resolve(__dirname, '../..')

test('recognizes keyboard context-menu commands without claiming plain F10', () => {
  assert.equal(isReviewContextMenuKey({ key: 'ContextMenu', shiftKey: false }), true)
  assert.equal(isReviewContextMenuKey({ key: 'F10', shiftKey: true }), true)
  assert.equal(isReviewContextMenuKey({ key: 'F10', shiftKey: false }), false)
})

test('anchors pointer and keyboard menus to bounded integer coordinates', () => {
  assert.deepEqual(pointerContextMenuPoint({ clientX: 24.6, clientY: 31.2 }), {
    x: 25,
    y: 31
  })
  assert.deepEqual(keyboardContextMenuPoint({ left: -4, bottom: 92.8 }), {
    x: 0,
    y: 93
  })
})

test('scales renderer coordinates into native menu coordinates', () => {
  assert.deepEqual(nativeContextMenuPoint({ x: 24, y: 31 }, 0.8), {
    x: 19,
    y: 25
  })
  assert.deepEqual(nativeContextMenuPoint({ x: 24, y: 31 }, 1.25), {
    x: 30,
    y: 39
  })
  assert.deepEqual(nativeContextMenuPoint({ x: 24, y: 31 }, 1.5), {
    x: 36,
    y: 47
  })
})

test('gives each review representation a stable focus identity', () => {
  assert.equal(
    reviewContextMenuFocusKey('review-list', 'mko_example'),
    'review-list:mko_example'
  )
  assert.equal(
    reviewContextMenuFocusKey('project-review-list', 'mko_example'),
    'project-review-list:mko_example'
  )
})

test('both review-list representations expose the native menu without activation', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/renderer.ts'), 'utf8')
  assert.match(
    renderer,
    /function openReviewContextMenu\([\s\S]*bridge\.openReviewContextMenu\(\{ reviewId, \.\.\.point \}\)[\s\S]*result\.outcome === 'copied'[\s\S]*Review link copied[\s\S]*data-review-context-menu-focus[\s\S]*focusTarget\?\.focus\(\{ preventScroll: true \}\)/
  )
  assert.match(
    renderer,
    /function createReviewListRow[\s\S]*bindReviewContextMenuKeyboard\([\s\S]*row\.reviewId,[\s\S]*'review-list'[\s\S]*openReviewContextMenu\(row\.reviewId, event, button, contextMenuFocusKey\)/
  )
  assert.match(
    renderer,
    /function createProjectReviewRow[\s\S]*bindReviewContextMenuKeyboard\([\s\S]*row\.reviewId,[\s\S]*'project-review-list'[\s\S]*openReviewContextMenu\(row\.reviewId, event, button, contextMenuFocusKey\)/
  )
})

test('native menu keeps copying separate from destructive review removal', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  assert.match(
    main,
    /nativeContextMenuPoint\([\s\S]*event\.sender\.getZoomFactor\(\)[\s\S]*menu\.popup\(\{[\s\S]*\.\.\.nativePoint/
  )
  assert.match(
    main,
    /label: 'Copy Review Link'[\s\S]*\{ type: 'separator' \}[\s\S]*label: 'Move Review to Trash…'/
  )
  assert.match(main, /buttons: \['Try Again', 'Cancel'\]/)
  assert.match(main, /detail: `\$\{failure\.message\}\\n\\n\$\{failure\.url\}`/)
})
