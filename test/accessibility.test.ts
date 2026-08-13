import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), 'utf8')

function hexLuminance(value: string): number {
  const channels = value.match(/[0-9a-f]{2}/gi)?.map((channel) => (
    Number.parseInt(channel, 16) / 255
  ))
  assert.equal(channels?.length, 3)
  const linear = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * (linear[0] ?? 0) +
    0.7152 * (linear[1] ?? 0) +
    0.0722 * (linear[2] ?? 0)
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = hexLuminance(foreground)
  const backgroundLuminance = hexLuminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

test('core review controls expose names, relationships, states, and values', () => {
  const dom = new JSDOM(read('src/index.html'))
  const document = dom.window.document

  const preview = document.querySelector('#preview-pane')
  assert.ok(preview)
  assert.equal(preview.getAttribute('tabindex'), '0')
  assert.match(preview.getAttribute('aria-label') || '', /Document tree.*arrow keys/i)

  const documentsResizer = document.querySelector('#documents-list-resizer')
  assert.ok(documentsResizer)
  assert.equal(documentsResizer.getAttribute('role'), 'separator')
  assert.equal(documentsResizer.getAttribute('tabindex'), '0')
  assert.equal(documentsResizer.getAttribute('aria-valuemin'), '150')

  const annotationResizer = document.querySelector('#annotation-pane-resizer')
  assert.ok(annotationResizer)
  assert.equal(annotationResizer.getAttribute('role'), 'separator')
  assert.equal(annotationResizer.getAttribute('tabindex'), '0')
  assert.equal(annotationResizer.getAttribute('aria-valuemin'), '360')

  for (const [tabId, panelId] of [
    ['annotation-view-selected', 'selected-annotation-view'],
    ['annotation-view-list', 'annotation-list-view']
  ]) {
    const tab = document.querySelector(`#${tabId}`)
    const panel = document.querySelector(`#${panelId}`)
    assert.ok(tab)
    assert.ok(panel)
    assert.equal(tab.getAttribute('role'), 'tab')
    assert.equal(tab.getAttribute('aria-controls'), panelId)
    assert.equal(panel.getAttribute('role'), 'tabpanel')
    assert.equal(panel.getAttribute('aria-labelledby'), tabId)
  }

  const attachmentList = document.querySelector('#attachment-list')
  assert.ok(attachmentList)
  assert.equal(attachmentList.getAttribute('role'), 'list')
  assert.equal(attachmentList.getAttribute('aria-label'), 'Attached screenshots')

  const reviewContext = document.querySelector('#review-context-drawer')
  assert.ok(reviewContext)
  assert.equal(reviewContext.tagName, 'DIALOG')
  assert.equal(reviewContext.getAttribute('aria-labelledby'), 'review-context-title')
})

test('status changes and tree selection have a dedicated polite announcement path', () => {
  const dom = new JSDOM(read('src/index.html'))
  const announcer = dom.window.document.querySelector('#status-announcer')
  assert.ok(announcer)
  assert.equal(announcer.getAttribute('role'), 'status')
  assert.equal(announcer.getAttribute('aria-live'), 'polite')
  assert.equal(announcer.getAttribute('aria-atomic'), 'true')

  const renderer = read('src/renderer.ts')
  assert.match(renderer, /function announceStatus\(message: string\)/)
  assert.match(renderer, /function announceNodeSelection\(node: ReviewNode\)/)
  assert.match(
    renderer,
    /const positionLabel = position\.index > 0[\s\S]*positionLabel,[\s\S]*hasAnnotation\(node\)/
  )
  assert.match(renderer, /showToast\(message: string\)[\s\S]*announceStatus\(message\)/)
  assert.match(renderer, /announceStatus\(`Removed attachment/)
  assert.match(renderer, /announceStatus\(`\$\{deletedName\} moved to Trash\.`\)/)
  assert.match(renderer, /screenshot\$\{savedImageCount === 1[\s\S]*attached\.`/)
  assert.match(renderer, /is now \$\{reviewStatusLabel\(status\)\}/)
})

test('keyboard access reaches native controls and retains an explicit pane shortcut', () => {
  const renderer = read('src/renderer.ts')
  assert.doesNotMatch(
    renderer,
    /document\.addEventListener\('keydown',[\s\S]*if \(event\.key === 'Tab'\) \{\s*event\.preventDefault\(\)/
  )
  assert.match(renderer, /event\.key === 'F6'[\s\S]*MarkoverNavigation\.nextPane/)
  assert.match(
    renderer,
    /function resizeDocumentsListFromKeyboard[\s\S]*ArrowLeft[\s\S]*ArrowRight/
  )
  assert.match(
    renderer,
    /documentsListResizer\.addEventListener\(\s*'keydown',[\s\S]*resizeDocumentsListFromKeyboard/
  )
  assert.match(renderer, /aria-keyshortcuts', 'F2'/)
  assert.match(renderer, /event\.key !== 'F2'[\s\S]*beginAttachmentLabelEdit/)
  assert.match(
    renderer,
    /event\.key === 'Tab'[\s\S]*event\.preventDefault\(\)[\s\S]*finish\(true, event\.shiftKey \? -1 : 1\)/
  )
  assert.match(
    renderer,
    /const focusTarget = tabDirection > 0[\s\S]*\.attachment-remove[\s\S]*\.attachment-thumbnail[\s\S]*focusTarget\?\.focus\(\)/
  )
  assert.match(
    renderer,
    /moveAnnotationViewTabFromKeyboard[\s\S]*filter\(\(tab\) => !tab\.disabled\)[\s\S]*currentIndex - 1 \+ tabs\.length\) % tabs\.length[\s\S]*currentIndex \+ 1\) % tabs\.length[\s\S]*target\.focus/
  )
  assert.match(
    renderer,
    /document-tab-overflow-trigger[\s\S]*aria-haspopup'[\s\S]*aria-expanded'[\s\S]*ArrowDown/
  )
  assert.match(
    renderer,
    /menu\.addEventListener\('keydown'[\s\S]*Home[\s\S]*End[\s\S]*ArrowDown[\s\S]*ArrowUp[\s\S]*\.focus\(\)/
  )
  assert.match(renderer, /closeTabOverflow\(true\)/)
  assert.match(
    renderer,
    /const isAnnotated = hasAnnotation\(node\)[\s\S]*if \(wasAnnotated !== isAnnotated\) \{[\s\S]*annotationState\.textContent = isAnnotated/
  )
})

test('attachment preview and destructive workflow restore a useful focus target', () => {
  const dom = new JSDOM(read('src/index.html'))
  const document = dom.window.document
  const imagePreview = document.querySelector('#image-preview')
  assert.ok(imagePreview)
  assert.equal(imagePreview.tagName, 'DIALOG')
  assert.equal(imagePreview.getAttribute('aria-labelledby'), 'image-preview-label')
  const imagePreviewClose = document.querySelector('#image-preview-close')
  assert.ok(imagePreviewClose)
  assert.equal(
    imagePreviewClose.getAttribute('aria-label'),
    'Close image preview'
  )

  const renderer = read('src/renderer.ts')
  assert.match(renderer, /imagePreviewReturnFocus = document\.activeElement/)
  assert.match(renderer, /imagePreview\.showModal\(\)[\s\S]*imagePreviewClose\.focus\(\)/)
  assert.match(renderer, /imagePreview\.addEventListener\('close',[\s\S]*returnFocus\?\.isConnected[\s\S]*returnFocus\.focus/)
  assert.match(renderer, /renderRemovedAttachment[\s\S]*requestAnimationFrame\(focusAnnotationPane\)/)
  assert.match(
    renderer,
    /function focusDocumentsList[\s\S]*\[data-review-id=[\s\S]*while \(ancestor && elements\.documentsListTree\.contains\(ancestor\)\)[\s\S]*ancestor instanceof HTMLDetailsElement[\s\S]*ancestor\.open = true[\s\S]*querySelector<HTMLElement>\('summary, button'\)/
  )
  assert.match(
    renderer,
    /function focusAfterInactiveReviewTrashed[\s\S]*!documentsListCollapsed[\s\S]*focusDocumentsList\(\)[\s\S]*\.document-tab\.is-active, \.document-tab-overflow-trigger[\s\S]*documentsListOpen[\s\S]*requestAnimationFrame\(focusAfterInactiveReviewTrashed\)/
  )
  assert.match(
    renderer,
    /async function closeDocumentTab[\s\S]*closeReviewTab\(reviewId\)[\s\S]*renderDocumentTabs\(\)[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*\.document-tab\.is-active, \.document-tab-overflow-trigger[\s\S]*\.focus\(\)/
  )
  assert.match(renderer, /handleReviewTrashed[\s\S]*previewPane\.focus\(\)[\s\S]*emptyOpenButton\.focus\(\)/)
  assert.match(renderer, /restoreReviewActivationFocus\(reviewId, focusSurface\)/)
  assert.match(
    renderer,
    /function restoreReviewActivationFocus[\s\S]*surface === 'documents' && target[\s\S]*while \(ancestor && elements\.documentsListTree\.contains\(ancestor\)\)[\s\S]*ancestor instanceof HTMLDetailsElement[\s\S]*ancestor\.open = true[\s\S]*target\?\.focus/
  )
  assert.match(
    renderer,
    /inboxHistoryLimit \+= INBOX_HISTORY_PAGE_SIZE[\s\S]*renderDocumentsList\(\)[\s\S]*recreatedHistory\.open = true[\s\S]*\.review-list-more[\s\S]*\.focus\(\)/
  )
  assert.match(
    renderer,
    /function documentsListFocusPath[\s\S]*documentsListTree\.contains\(active\)[\s\S]*path\.unshift\(Array\.from\(parent\.children\)\.indexOf\(current\)\)/
  )
  assert.match(
    renderer,
    /function restoreDocumentsListFocus[\s\S]*target\.children\.item\(index\)[\s\S]*ancestor instanceof HTMLDetailsElement[\s\S]*ancestor\.open = true[\s\S]*target\.focus\(\{ preventScroll: true \}\)/
  )
  assert.match(
    renderer,
    /scheduleDocumentsListClockRefresh[\s\S]*const focusPath = documentsListFocusPath\(\)[\s\S]*renderDocumentsList\(\)[\s\S]*restoreDocumentsListFocus\(focusPath\)/
  )
  assert.match(
    renderer,
    /function setDocumentsListCollapsed[\s\S]*restoreKeyboardFocus = document\.activeElement[\s\S]*collapsed \? elements\.documentsListCollapse : elements\.documentsListOpen[\s\S]*collapsed[\s\S]*elements\.documentsListOpen[\s\S]*elements\.documentsListCollapse[\s\S]*target\.focus\(\)/
  )
  assert.match(
    renderer,
    /function documentTabsFocusPath[\s\S]*documentTabs\.contains\(active\)[\s\S]*path\.unshift\(Array\.from\(parent\.children\)\.indexOf\(current\)\)/
  )
  assert.match(
    renderer,
    /function restoreDocumentTabsFocus[\s\S]*target\.closest<HTMLElement>\('\.document-tab-overflow'\)[\s\S]*classList\.add\('is-open'\)[\s\S]*target\.focus\(\{ preventScroll: true \}\)/
  )
  assert.match(
    renderer,
    /onReviewStatus[\s\S]*documentsFocusPath = documentsListFocusPath\(\)[\s\S]*tabsFocusPath = documentTabsFocusPath\(\)[\s\S]*renderDocumentTabs\(\)[\s\S]*restoreDocumentsListFocus\(documentsFocusPath\)[\s\S]*restoreDocumentTabsFocus\(tabsFocusPath\)/
  )
  assert.match(
    renderer,
    /function saveSourceEdit[\s\S]*restoreKeyboardFocus = document\.activeElement === elements\.sourceSave[\s\S]*renderAnnotation\(node\)[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*elements\.sourceEdit\.focus\(\)/
  )
  assert.match(
    renderer,
    /function cancelSourceEdit[\s\S]*document\.activeElement === elements\.sourceCancel[\s\S]*renderSourcePanel\(node\)[\s\S]*elements\.sourceEdit\.focus\(\)/
  )
  assert.match(
    renderer,
    /function revertSourceEdit[\s\S]*document\.activeElement === elements\.sourceRevert[\s\S]*renderAnnotation\(node\)[\s\S]*elements\.sourceEdit\.focus\(\)/
  )
  assert.match(renderer, /restoreFocus = document\.activeElement === disclosure[\s\S]*\.disclosure`[\s\S]*\.focus\(\)/)
})

test('motion and focus styling remain usable with accessibility preferences', () => {
  const styles = read('src/styles.css')
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*scroll-behavior: auto !important;[\s\S]*transition-duration: 0\.01ms !important;/
  )
  assert.match(styles, /:is\(button, a, summary, \[role="button"\]\):focus-visible/)
  assert.match(styles, /documents-list-resizer:focus-visible::after/)
  assert.match(styles, /annotation-pane-resizer:focus-visible::after/)
})

test('default muted text meets AA contrast on the darkest light surface', () => {
  const styles = read('src/styles.css')
  const rootBlock = /^:root \{([\s\S]*?)^\}/m.exec(styles)?.[1]
  assert.ok(rootBlock)
  const muted = /--muted:\s*(#[0-9a-f]{6})/i.exec(rootBlock)?.[1]
  const paper = /--paper:\s*(#[0-9a-f]{6})/i.exec(rootBlock)?.[1]
  assert.ok(muted)
  assert.ok(paper)
  assert.ok(
    contrastRatio(muted, paper) >= 4.5,
    `${muted} on ${paper} must meet 4.5:1`
  )
})
