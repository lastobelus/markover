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

  const preview = document.querySelector('#center-pane')
  assert.ok(preview)
  assert.equal(preview.getAttribute('tabindex'), '0')
  assert.match(preview.getAttribute('aria-label') || '', /Document tree.*arrow keys/i)

  const documentsResizer = document.querySelector('#left-pane-resizer')
  assert.ok(documentsResizer)
  assert.equal(documentsResizer.getAttribute('role'), 'separator')
  assert.equal(documentsResizer.getAttribute('tabindex'), '0')
  assert.equal(documentsResizer.getAttribute('aria-valuemin'), '150')

  const annotationResizer = document.querySelector('#right-pane-resizer')
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

  const reviewIdForm = document.querySelector('#review-id-activation')
  const reviewIdInput = document.querySelector('#review-id-input')
  const documentReviewId = document.querySelector('#document-review-id')
  assert.ok(reviewIdForm)
  assert.ok(reviewIdInput)
  assert.ok(documentReviewId)
  assert.equal(reviewIdInput.getAttribute('pattern'), 'mko_[A-Za-z0-9]{6,32}')
  assert.equal(reviewIdInput.getAttribute('aria-describedby'), 'review-id-activation-hint')
  assert.equal(documentReviewId.getAttribute('aria-label'), 'Copy review ID')
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
    /function resizeLeftPaneFromKeyboard[\s\S]*ArrowLeft[\s\S]*ArrowRight/
  )
  assert.match(
    renderer,
    /leftPaneResizer\.addEventListener\(\s*'keydown',[\s\S]*resizeLeftPaneFromKeyboard/
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
    /reviewIdActivation\.addEventListener\('submit'[\s\S]*reviewIdInput\.reportValidity\(\)[\s\S]*activateReview\(reviewId\)/
  )
  assert.match(renderer, /documentReviewId\.addEventListener\('click'[\s\S]*bridge\.copyText\(state\.reviewId\)/)
  assert.match(renderer, /reviewIdDescription\.textContent = `Review ID \$\{row\.reviewId\}`[\s\S]*button\.setAttribute\('aria-describedby', reviewIdDescription\.id\)/)
  assert.match(
    renderer,
    /const isAnnotated = hasAnnotation\(node\)[\s\S]*if \(wasAnnotated !== isAnnotated\) \{[\s\S]*annotationState\.textContent = isAnnotated/
  )
})

test('left pane tabs expose their controlled review panel', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.ts')
  const dom = new JSDOM(html)
  const tablist = dom.window.document.querySelector('[aria-label="Review organization"]')
  const collapse = dom.window.document.querySelector('#left-pane-collapse')

  assert.ok(tablist)
  assert.ok(collapse)
  assert.equal(tablist.querySelectorAll(':scope > [role="tab"]').length, 2)
  assert.equal(tablist.contains(collapse), false)
  assert.match(html, /id="review-navigation-inbox"[\s\S]*role="tab"[\s\S]*aria-controls="documents-list-tree"/)
  assert.match(html, /id="review-navigation-projects"[\s\S]*role="tab"[\s\S]*aria-controls="documents-list-tree"/)
  assert.match(html, /id="documents-list-tree"[\s\S]*role="tabpanel"[\s\S]*aria-labelledby="review-navigation-inbox"/)
  assert.match(renderer, /documentsListTree\.setAttribute\([\s\S]*'aria-labelledby',[\s\S]*review-navigation-inbox[\s\S]*review-navigation-projects/)
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
  assert.match(renderer, /renderRemovedAttachment[\s\S]*requestAnimationFrame\(focusRightPane\)/)
  assert.match(
    renderer,
    /function focusLeftPane[\s\S]*\[data-review-id=[\s\S]*while \(ancestor && elements\.documentsListTree\.contains\(ancestor\)\)[\s\S]*ancestor instanceof HTMLDetailsElement[\s\S]*ancestor\.open = true[\s\S]*querySelector<HTMLElement>\('summary, button'\)/
  )
  assert.match(
    renderer,
    /function focusAfterInactiveReviewTrashed[\s\S]*!leftPaneCollapsed[\s\S]*focusLeftPane\(\)[\s\S]*leftPaneOpen\.focus\(\)[\s\S]*requestAnimationFrame\(focusAfterInactiveReviewTrashed\)/
  )
  assert.match(renderer, /handleReviewTrashed[\s\S]*centerPane\.focus\(\)[\s\S]*emptyOpenButton\.focus\(\)/)
  assert.match(renderer, /restoreReviewActivationFocus\(reviewId, focusSurface\)/)
  assert.match(
    renderer,
    /function restoreReviewActivationFocus[\s\S]*elements\.documentsListTree\.querySelector[\s\S]*while \(ancestor && elements\.documentsListTree\.contains\(ancestor\)\)[\s\S]*ancestor instanceof HTMLDetailsElement[\s\S]*ancestor\.open = true[\s\S]*target\?\.focus/
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
    /function setLeftPaneCollapsed[\s\S]*restoreKeyboardFocus = document\.activeElement[\s\S]*collapsed \? elements\.leftPaneCollapse : elements\.leftPaneOpen[\s\S]*collapsed[\s\S]*elements\.leftPaneOpen[\s\S]*elements\.leftPaneCollapse[\s\S]*target\.focus\(\)/
  )
  assert.match(
    renderer,
    /function documentsListReviewFocus[\s\S]*closest<HTMLElement>\('\[data-review-id\]'\)[\s\S]*review-list-row-pr[\s\S]*'pull-request'[\s\S]*'open'/
  )
  assert.match(
    renderer,
    /function restoreDocumentsListReviewFocus[\s\S]*data-review-id[\s\S]*while \(ancestor && elements\.documentsListTree\.contains\(ancestor\)\)[\s\S]*ancestor\.open = true[\s\S]*review-list-row-pr[\s\S]*review-list-row-open, \.review-project-leaf-open, button[\s\S]*focus\(\{ preventScroll: true \}\)/
  )
  assert.match(
    renderer,
    /function renderDocumentsListPreservingFocus[\s\S]*documentsReviewFocus = documentsListReviewFocus\(\)[\s\S]*documentsFocusPath = documentsReviewFocus[\s\S]*renderDocumentsList\(\)[\s\S]*restoreDocumentsListReviewFocus\(documentsReviewFocus\)[\s\S]*restoreDocumentsListFocus\(documentsFocusPath\)/
  )
  assert.match(
    renderer,
    /onReviewUpdated[\s\S]*normalizeSessionWorkspaceState\(session\)[\s\S]*renderDocumentsListPreservingFocus\(\)/
  )
  assert.match(
    renderer,
    /onReviewStatus[\s\S]*renderDocumentsListPreservingFocus\(\)/
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
  assert.match(styles, /left-pane-resizer:focus-visible::after/)
  assert.match(styles, /right-pane-resizer:focus-visible::after/)
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
