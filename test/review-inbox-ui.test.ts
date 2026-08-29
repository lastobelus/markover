import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('the document-tree review ID reveals exact-ID controls', () => {
  const html = read('src/index.html')
  const styles = read('src/styles.css')

  assert.match(
    html,
    /class="document-review-control"[\s\S]*id="document-review-id"[\s\S]*aria-expanded="false"[\s\S]*id="review-id-activation"[\s\S]*id="review-id-input"[\s\S]*id="review-id-copy"/
  )
  assert.match(
    styles,
    /\.review-tab-strip \{[\s\S]*grid-template-columns: var\(--left-pane-width\) minmax\(0, 1fr\);/
  )
  assert.match(styles, /\.review-list-row-meta \{[^}]*font-size: 10px;/)
})

test('production inbox shares responsibility filters and retains All history', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.ts')
  const icons = read('src/lucide-icons.ts')
  const registry = read('src/review-icon-registry.ts')
  const styles = read('src/styles.css')

  assert.match(renderer, /projectReviewInbox\([\s\S]*codexThreadTitles: codexThreadTitles\.titles,[\s\S]*claudeThreadTitles: claudeThreadTitles\.titles,[\s\S]*t3ThreadTitles: t3ThreadTitles\.titles,[\s\S]*titlePreference: preferences\.inboxTitlePreference/)
  assert.match(
    renderer,
    /renderInboxReviews\(projection\.editing, projection\.history, reviewFilter\)/
  )
  assert.match(renderer, /let reviewFilter: ReviewInboxFilter = 'needs-me'/)
  assert.match(renderer, /projection\.filterCounts\['needs-me'\]/)
  assert.match(renderer, /elements\.reviewFilter\.addEventListener\('change'/)
  assert.match(renderer, /selectedReviewIds\.clear\(\)[\s\S]*setReviewNavigationMode\('projects'\)/)
  const leftPane = html.slice(
    html.indexOf('<aside id="left-pane"'),
    html.indexOf('</aside>', html.indexOf('<aside id="left-pane"'))
  )
  assert.match(html, /id="review-filter"[\s\S]*value="needs-me"[\s\S]*value="with-agent"[\s\S]*value="completed"[\s\S]*value="all"/)
  assert.doesNotMatch(leftPane, /id="review-list-count"|class="eyebrow">Reviews/)
  assert.match(styles, /\.review-filter \{[^}]*color: var\(--muted\);/)
  assert.match(styles, /\.review-selection \{[^}]*top: 50%;[^}]*margin: 0;[^}]*transform: translateY\(-50%\);/)
  assert.match(html, /class="review-trash-heading">[\s\S]*id="review-trash-icon"[\s\S]*id="review-trash-title"/)
  assert.match(styles, /\.review-trash-heading \{[^}]*align-items: center;[^}]*justify-content: center;[^}]*gap: 16px;/)
  assert.match(styles, /\.review-trash-actions \{[^}]*grid-template-columns: 1fr 1fr;/)
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
  const filteredInboxStart = renderer.indexOf("if (filter !== 'all')")
  const filteredInbox = renderer.slice(
    filteredInboxStart,
    renderer.indexOf('\n  const fragment =', filteredInboxStart + 1)
  )
  assert.doesNotMatch(filteredInbox, /review-list-section-heading|shown/)
  assert.match(filteredInbox, /setAttribute\('aria-label', `\$\{label\} reviews`\)/)
  assert.match(registry, /aliases: \['codex', 'openai'\]/)
  assert.match(registry, /aliases: \['claude', 'claudeagent', 'anthropic'\]/)
  assert.match(registry, /aliases: \['t3code'\]/)
  assert.match(renderer, /threadHostIcon\(row\.threadHostKind\)/)
  assert.match(renderer, /registeredIconsMatch\(providerDefinition, threadHostDefinition\)/)
  assert.match(renderer, /stack\.append\(primary, threadHost\)/)
  assert.doesNotMatch(styles, /has-thread-host:hover/)
  assert.match(renderer, /thread\.reviews\.map\(createProjectReviewRow\)/)
  assert.match(renderer, /bindReviewHoverCard\(button, \(\) => reviewHoverModel\(row\)\)/)
  assert.match(renderer, /bindReviewHoverCard\(summary, \(\) => projectHoverModel\(project\)\)/)
  assert.match(renderer, /bindReviewHoverCard\(summary, \(\) => threadHoverModel\(thread, project\)\)/)
  assert.match(renderer, /markoverIcon\('messages-square', 'review-thread-icon'\)/)
  assert.match(renderer, /markoverIcon\('chevron-right', 'is-closed'\)/)
  assert.match(renderer, /replaceMarkoverIcon\(elements\.leftPaneCollapse, 'panel-left-close'\)/)
  assert.match(renderer, /replaceMarkoverIcon\(elements\.canonicalUpdateButton, 'refresh-cw'\)/)
  assert.match(html, /id="canonical-update-footer"[\s\S]*id="canonical-update-button"[\s\S]*aria-describedby="canonical-update-tooltip"/)
  assert.match(styles, /\.canonical-update-footer \{[^}]*min-height: 40px;[^}]*justify-content: flex-end;/)
  assert.match(icons, /from 'lucide\/dist\/esm\/lucide\/src\/lucide\.js'/)
  assert.match(styles, /\.review-details-disclosure \.lucide-icon/)
  assert.match(styles, /\.review-project-leaf-status/)
  assert.match(styles, /\.review-project-leaf \{[\s\S]*position: relative;/)
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
  assert.match(renderer, /reviewSelectionControl\(row\)/)
  assert.match(renderer, /let batchResolutionMode = false/)
  assert.match(renderer, /!batchResolutionMode \|\|[\s\S]*!reviewMatchesFilter/)
  assert.match(renderer, /reviewBatchActions\.hidden = !batchResolutionMode/)
  assert.match(renderer, /reviewBatchNoNotes\.disabled = count === 0/)
  assert.match(renderer, /onReviewBatchModeRequested/)
  assert.match(renderer, /batchResolutionMode = false[\s\S]*selectedReviewIds\.clear\(\)/)
  assert.match(renderer, /selection\.title = 'Select for completion'/)
  assert.match(renderer, /bridge\.resolveReviews\(\{ reviewIds, outcome \}\)/)
  assert.match(renderer, /showReviewResolutionConfirmation/)
  assert.match(renderer, /review\.blocks\[0\][\s\S]*resolutionBlockPreview/)
  assert.match(renderer, /Abandon feedback in \$\{String\(feedbackReviewCount\)\}/)
  assert.match(renderer, /document\.createElement\('details'\)/)
  assert.match(renderer, /bridge\.unresolveReview\(row\.reviewId\)/)
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
  assert.match(renderer, /label: 'Review ID',[\s\S]*text: row\.reviewId[\s\S]*markoverIcon\('hash'\)/)
  assert.match(renderer, /reviewIdDescription\.textContent = `Review ID \$\{row\.reviewId\}`[\s\S]*button\.setAttribute\('aria-describedby', reviewIdDescription\.id\)/)
  assert.match(html, /id="document-review-id"[\s\S]*aria-label="Show review ID controls"/)
  assert.doesNotMatch(html, /id="document-tabs"|document-tab-close/)
  assert.doesNotMatch(renderer, /openReviewIds|closeDocumentTab|createDocumentTab/)
  assert.doesNotMatch(workspace, /openReviewIds/)
})

test('hover and review information share complete metadata and error presentation', () => {
  const renderer = read('src/renderer.ts')
  const inbox = read('src/review-inbox.ts')
  const html = read('src/index.html')
  const styles = read('src/styles.css')

  for (const label of [
    'Project',
    'Source path',
    'Source state',
    'Repository',
    'Branch',
    'Commit',
    'Pull request',
    'Pull request status',
    'Requesting thread',
    'Requesting thread title',
    'Thread host',
    'Provider',
    'Distinct host thread',
    'Machine',
    'Review status',
    'Created',
    'Updated',
    'Attention requested'
  ]) assert.match(inbox, new RegExp(`'${label}'`))

  assert.match(renderer, /reviewHoverModel[\s\S]*reviewMetadataInventory\(row\)/)
  assert.match(renderer, /renderReviewContext[\s\S]*reviewMetadataInventory\(row\)/)
  assert.match(renderer, /inventory\.fields[\s\S]*reviewMetadataVisual/)
  assert.match(renderer, /review-hover-issues[\s\S]*inventory\.issues/)
  assert.match(renderer, /reviewContextIssues\.textContent = inventory\.issues\.join/)
  assert.match(renderer, /createMetadataStateMarker\(row\)/)
  assert.match(html, /id="document-source-state"/)
  assert.match(html, /id="source-card-state" class="source-card-state" hidden/)
  assert.match(renderer, /row\.sourceState === 'changed' \? 'Source changed' : null/)
  assert.match(renderer, /sourceCardState\.hidden = sourceCardState === null/)
  assert.match(styles, /\.source-card-state \{[^}]*color: var\(--source-error\);/)
  assert.match(html, /id="review-context-issues"[\s\S]*role="status"/)
  assert.match(styles, /\.review-hover-entry\.is-error,[\s\S]*var\(--source-error\)/)
  assert.match(styles, /\.review-context-fields dd\.is-error,[\s\S]*var\(--source-error\)/)
})

test('thread-title integrations expose source-specific settings and event refreshes', () => {
  const html = read('src/index.html')
  const renderer = read('src/renderer.ts')

  assert.match(html, /name="t3ThreadTitlesEnabled"[^>]*role="switch"/)
  assert.match(html, /name="t3MetadataDatabasePath"[\s\S]*~\/\.t3\/userdata\/state\.sqlite/)
  assert.match(html, /name="inboxTitlePreference"[\s\S]*value="review-purpose"[\s\S]*value="requesting-thread-title"/)
  assert.match(html, /id="t3-thread-title-status"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(html, /id="t3-thread-titles-refresh"[\s\S]*Refresh titles now/)
  assert.match(html, /name="codexThreadTitlesEnabled"[^>]*role="switch"/)
  assert.match(html, /name="codexExecutablePath"[\s\S]*\/opt\/homebrew\/bin\/codex/)
  assert.match(html, /id="codex-thread-title-status"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(html, /id="codex-thread-titles-refresh"[\s\S]*Refresh Codex titles now/)
  assert.match(html, /name="claudeThreadTitlesEnabled"[^>]*role="switch"/)
  assert.match(html, /id="claude-thread-title-status"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(html, /id="claude-thread-titles-refresh"[\s\S]*Refresh Claude Code titles now/)
  assert.match(renderer, /t3ThreadTitlesRefresh\.addEventListener\('click',[\s\S]*refreshRequestingThreadTitles\(\)/)
  assert.match(renderer, /codexThreadTitlesRefresh\.addEventListener\('click',[\s\S]*refreshRequestingThreadTitles\(\)/)
  assert.match(renderer, /claudeThreadTitlesRefresh\.addEventListener\('click',[\s\S]*refreshRequestingThreadTitles\(\)/)
  assert.match(renderer, /refreshRequestingThreadTitles[\s\S]*bridge\.getReviews\(\)/)
  assert.match(
    renderer,
    /requestingThreadTitleRefresh = requestingThreadTitleRefresh\.then\(\s*refresh,\s*refresh\s*\)/
  )
  assert.match(renderer, /onWindowFocusChanged\([\s\S]*focusState\.focused\) void refreshRequestingThreadTitles\(\)/)
  assert.match(renderer, /function queueIncomingReview[\s\S]*handleIncomingReview\(reviewDocument\)[\s\S]*refreshRequestingThreadTitles\(\)/)
  assert.match(renderer, /onReviewUpdated\([\s\S]*refreshRequestingThreadTitles\(\)/)
  assert.match(renderer, /function setReviewNavigationMode[\s\S]*void refreshRequestingThreadTitles\(\)/)
  assert.match(renderer, /restoring-workspace[\s\S]*renderDocumentsList\(\)[\s\S]*void refreshRequestingThreadTitles\(\)/)
  assert.doesNotMatch(renderer, /setInterval\([^)]*refreshT3ThreadTitles/)
  assert.doesNotMatch(renderer, /setInterval\([^)]*refreshCodexThreadTitles/)
  assert.doesNotMatch(renderer, /setInterval\([^)]*refreshClaudeThreadTitles/)
})
