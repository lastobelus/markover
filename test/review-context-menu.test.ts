import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  isReviewContextMenuKey,
  keyboardContextMenuPoint,
  pointerContextMenuPoint
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

test('both review representations expose the native menu without activation', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/renderer.ts'), 'utf8')
  assert.match(
    renderer,
    /function openReviewContextMenu\([\s\S]*bridge\.openReviewContextMenu\(\{ reviewId, \.\.\.point \}\)[\s\S]*result\.outcome === 'copied'[\s\S]*Review link copied[\s\S]*anchor\.focus\(\{ preventScroll: true \}\)/
  )
  assert.match(
    renderer,
    /function createReviewListRow[\s\S]*bindReviewContextMenuKeyboard\(button, row\.reviewId\)[\s\S]*openReviewContextMenu\(row\.reviewId, event, button\)/
  )
  assert.match(
    renderer,
    /function createDocumentTab[\s\S]*bindReviewContextMenuKeyboard\(button, session\.reviewId\)[\s\S]*openReviewContextMenu\(session\.reviewId, event, button\)/
  )
})

test('native menu keeps copying separate from destructive review removal', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8')
  assert.match(
    main,
    /label: 'Copy Review Link'[\s\S]*\{ type: 'separator' \}[\s\S]*label: 'Move Review to Trash…'/
  )
  assert.match(main, /buttons: \['Try Again', 'Cancel'\]/)
  assert.match(main, /detail: `\$\{failure\.message\}\\n\\n\$\{failure\.url\}`/)
})
