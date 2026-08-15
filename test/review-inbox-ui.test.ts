import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('production review navigation shares the strip with exact-ID activation', () => {
  const html = read('src/index.html')
  const styles = read('src/styles.css')

  assert.match(
    html,
    /id="review-tab-strip"[\s\S]*id="review-navigation-inbox"[\s\S]*id="review-navigation-projects"[\s\S]*id="review-id-activation"[\s\S]*id="review-id-input"/
  )
  assert.match(
    styles,
    /\.review-tab-strip \{[\s\S]*grid-template-columns: var\(--documents-list-width\) minmax\(0, 1fr\);/
  )
  assert.match(styles, /\.review-list-row-meta \{[^}]*font-size: 10px;/)
})

test('production inbox renders Editing separately from lifecycle-aware collapsed history', () => {
  const renderer = read('src/renderer.ts')
  const icons = read('src/lucide-icons.ts')
  const registry = read('src/review-icon-registry.ts')
  const styles = read('src/styles.css')

  assert.match(renderer, /projectReviewInbox\([\s\S]*t3ThreadTitles\.titles,[\s\S]*preferences\.inboxTitlePreference/)
  assert.match(
    renderer,
    /renderInboxReviews\(projection\.editing, projection\.history\)/
  )
  assert.match(renderer, /historyGroup\.className = 'review-history-group'/)
  assert.match(renderer, /historySummary\.innerHTML = `<span>History<\/span>/)
  assert.match(
    renderer,
    /activeHistory = history\.find\([\s\S]*visibleHistory\.push\(activeHistory\)[\s\S]*historyGroup\.open = Boolean\(activeHistory\)/
  )
  assert.match(renderer, /reviewStatusLabel\(row\.status\)/)
  assert.match(renderer, /row\.status === 'pending-agent'[\s\S]*'with-agent'[\s\S]*`is-\$\{row\.status\}`/)
  assert.match(renderer, /`is-\$\{row\.pullRequestStatus \|\| 'linked'\}`/)
  assert.match(renderer, /PR #\$\{row\.pullRequestNumber\}: \$\{row\.pullRequestStatus\}\./)
  assert.doesNotMatch(renderer, /reported by \$\{source\} \$\{age\}/)
  assert.match(registry, /aliases: \['codex', 'openai'\]/)
  assert.match(registry, /aliases: \['claude', 'claudeagent', 'anthropic'\]/)
  assert.match(registry, /aliases: \['t3code'\]/)
  assert.match(renderer, /threadHostIcon\(row\.threadHostKind\)/)
  assert.match(renderer, /registeredIconsMatch\(providerDefinition, threadHostDefinition\)/)
  assert.match(renderer, /stack\.append\(primary, threadHost\)/)
  assert.doesNotMatch(styles, /has-thread-host:hover/)
  assert.match(renderer, /thread\.reviews\.map\(createProjectReviewRow\)/)
  assert.match(renderer, /bindReviewHoverCard\(container, \(\) => reviewHoverModel\(row\)\)/)
  assert.match(renderer, /bindReviewHoverCard\(summary, \(\) => projectHoverModel\(project\)\)/)
  assert.match(renderer, /bindReviewHoverCard\(summary, \(\) => threadHoverModel\(thread, project\)\)/)
  assert.match(renderer, /markoverIcon\('messages-square', 'review-thread-icon'\)/)
  assert.match(renderer, /markoverIcon\('chevron-right', 'is-closed'\)/)
  assert.match(renderer, /replaceMarkoverIcon\(elements\.documentsListCollapse, 'panel-left-close'\)/)
  assert.match(icons, /from 'lucide\/dist\/esm\/lucide\/src\/lucide\.js'/)
  assert.match(styles, /\.review-details-disclosure \.lucide-icon/)
  assert.match(styles, /\.review-project-leaf-status/)
  assert.match(styles, /\.review-hover-card/)
  assert.match(styles, /\.review-thread-reviews \{[\s\S]*padding-left: 46px;/)
  assert.match(styles, /\.review-project-leaf\.is-active \{[\s\S]*margin-left: -24px;/)
  assert.match(styles, /\.review-project-leaf\.is-active \.review-project-leaf-open \{[\s\S]*padding-left: 26px;/)
  assert.match(styles, /\.review-project-leaf-title \{[\s\S]*font-weight: 400;/)
  assert.doesNotMatch(
    renderer,
    /function threadSummary[\s\S]*?label\.append\(provider, title\)/
  )
  assert.match(renderer, /bridge\.getProjectFavicon\(reviewId\)/)
  assert.match(renderer, /bridge\.openPullRequest\(row\.reviewId\)/)
  assert.match(renderer, /const INBOX_HISTORY_PAGE_SIZE = 10/)
  assert.match(renderer, /viewAll\.textContent = 'View all in Projects'/)
})

test('review activation uses one active review and exposes exact IDs', () => {
  const renderer = read('src/renderer.ts')
  const html = read('src/index.html')
  const workspace = read('src/workspace-state.ts')

  assert.match(
    renderer,
    /async function activateReview\([\s\S]*reviewSessions\.activate\(reviewId\)/
  )
  assert.match(
    renderer,
    /reviewIdActivation\.addEventListener\('submit'[\s\S]*reviewSessions\.get\(reviewId\)[\s\S]*activateReview\(reviewId\)/
  )
  assert.match(renderer, /documentReviewId\.textContent = review\.id/)
  assert.match(renderer, /addReviewContextCopyField\('Review ID', review\.id\)/)
  assert.match(
    renderer,
    /restoreReviewContextCopyFocus[\s\S]*reviewIdCopy = addReviewContextCopyField\('Review ID', review\.id\)[\s\S]*if \(restoreReviewContextCopyFocus\) reviewIdCopy\.focus\(\)/
  )
  assert.match(renderer, /icon: 'hash',[\s\S]*text: row\.reviewId/)
  assert.match(renderer, /reviewIdDescription\.textContent = `Review ID \$\{row\.reviewId\}`[\s\S]*button\.setAttribute\('aria-describedby', reviewIdDescription\.id\)/)
  assert.match(html, /id="document-review-id"[\s\S]*aria-label="Copy review ID"/)
  assert.doesNotMatch(html, /id="document-tabs"|document-tab-close/)
  assert.doesNotMatch(renderer, /openReviewIds|closeDocumentTab|createDocumentTab/)
  assert.doesNotMatch(workspace, /openReviewIds/)
})

test('T3 titles expose explicit settings, status, and only event-driven refreshes', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.ts')

  assert.match(html, /name="t3ThreadTitlesEnabled"[^>]*role="switch"/)
  assert.match(html, /name="t3MetadataDatabasePath"[\s\S]*~\/\.t3\/userdata\/state\.sqlite/)
  assert.match(html, /name="inboxTitlePreference"[\s\S]*value="review-purpose"[\s\S]*value="requesting-thread-title"/)
  assert.match(html, /id="t3-thread-title-status"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(html, /id="t3-thread-titles-refresh"[\s\S]*Refresh titles now/)
  assert.match(renderer, /t3ThreadTitlesRefresh\.addEventListener\('click',[\s\S]*refreshT3ThreadTitles\(\)/)
  assert.match(renderer, /onWindowFocusChanged\([\s\S]*focusState\.focused\) void refreshT3ThreadTitles\(\)/)
  assert.match(renderer, /function queueIncomingReview[\s\S]*handleIncomingReview\(reviewDocument\)[\s\S]*refreshT3ThreadTitles\(\)/)
  assert.match(renderer, /onReviewUpdated\([\s\S]*refreshT3ThreadTitles\(\)/)
  assert.match(renderer, /function setReviewNavigationMode[\s\S]*void refreshT3ThreadTitles\(\)/)
  assert.match(renderer, /restoring-workspace[\s\S]*renderDocumentsList\(\)[\s\S]*void refreshT3ThreadTitles\(\)/)
  assert.doesNotMatch(renderer, /setInterval\([^)]*refreshT3ThreadTitles/)
})
