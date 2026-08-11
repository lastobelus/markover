import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string => fs.readFileSync(
  path.join(root, relativePath),
  'utf8'
)

test('production review navigation owns the sidebar side of the tab strip', () => {
  const html = read('src/index.html')
  const styles = read('src/styles.css')

  assert.match(
    html,
    /id="review-tab-strip"[\s\S]*id="review-navigation-inbox"[\s\S]*id="review-navigation-projects"[\s\S]*id="document-tabs"/
  )
  assert.match(
    styles,
    /\.review-tab-strip \{[\s\S]*grid-template-columns: var\(--documents-list-width\) minmax\(0, 1fr\);/
  )
  assert.match(styles, /\.review-list-row-meta \{[^}]*font-size: 10px;/)
})

test('production inbox renders Editing separately from lifecycle-aware collapsed history', () => {
  const renderer = read('src/renderer.ts')

  assert.match(renderer, /projectReviewInbox\(sessions\)/)
  assert.match(
    renderer,
    /renderInboxReviews\(projection\.editing, projection\.history\)/
  )
  assert.match(renderer, /historyGroup\.className = 'review-history-group'/)
  assert.match(renderer, /historySummary\.innerHTML = `<span>History<\/span>/)
  assert.match(renderer, /reviewStatusLabel\(row\.status\)/)
  assert.match(renderer, /row\.status === 'pending-agent'[\s\S]*'with-agent'[\s\S]*`is-\$\{row\.status\}`/)
  assert.match(renderer, /`is-\$\{row\.pullRequestStatus \|\| 'linked'\}`/)
  assert.match(renderer, /reported by \$\{source\} \$\{age\}/)
  assert.match(renderer, /OPENAI_ICON_PATH/)
  assert.match(renderer, /CLAUDE_ICON_PATH/)
  assert.match(renderer, /bridge\.getProjectFavicon\(reviewId\)/)
  assert.match(renderer, /bridge\.openPullRequest\(row\.reviewId\)/)
  assert.match(renderer, /const INBOX_HISTORY_PAGE_SIZE = 10/)
  assert.match(renderer, /viewAll\.textContent = 'View all in Projects'/)
})

test('review activation opens a working-set tab without changing lifecycle state', () => {
  const renderer = read('src/renderer.ts')

  assert.match(
    renderer,
    /async function activateReview\([\s\S]*openReviewIds\.add\(reviewId\)/
  )
  assert.match(
    renderer,
    /function renderDocumentTabs\(\): void \{\s*const sessions = openReviewSessions\(\)/
  )
  assert.match(renderer, /close\.className = 'document-tab-close'/)
  assert.doesNotMatch(
    renderer,
    /closeDocumentTab[\s\S]{0,500}updateStatus/
  )
})
