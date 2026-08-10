import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalPullRequestMetadata,
  githubRepositoryIdentity,
  hasPullRequestObservationFields,
  isPullRequestStatus,
  parseGitHubPullRequestUrl,
  pullRequestObservation,
  reviewPullRequestIdentity
} from '../src/pull-request'

test('normalizes GitHub repository remotes without cross-host guessing', () => {
  assert.equal(
    githubRepositoryIdentity('git@github.com:Lastobelus/Markover.git'),
    'lastobelus/markover'
  )
  assert.equal(
    githubRepositoryIdentity('https://github.com/Lastobelus/Markover.git'),
    'lastobelus/markover'
  )
  assert.equal(
    githubRepositoryIdentity('ssh://git@github.com/Lastobelus/Markover.git'),
    'lastobelus/markover'
  )
  assert.equal(githubRepositoryIdentity('https://gitlab.com/a/b.git'), null)
  assert.equal(githubRepositoryIdentity('not a remote'), null)
})

test('parses exact GitHub pull request URLs', () => {
  assert.deepEqual(
    parseGitHubPullRequestUrl(
      'https://github.com/Lastobelus/Markover/pull/123'
    ),
    {
      number: 123,
      repository: 'lastobelus/markover',
      url: 'https://github.com/lastobelus/markover/pull/123'
    }
  )
  assert.equal(
    parseGitHubPullRequestUrl('https://github.com/a/b/issues/123'),
    null
  )
  assert.equal(
    parseGitHubPullRequestUrl('http://github.com/a/b/pull/123'),
    null
  )
})

test('derives review pull request identity from explicit or Git metadata', () => {
  assert.deepEqual(
    reviewPullRequestIdentity(
      { number: 7 },
      { repositoryUrl: 'git@github.com:Lastobelus/Markover.git' }
    ),
    {
      number: 7,
      repository: 'lastobelus/markover',
      url: 'https://github.com/lastobelus/markover/pull/7'
    }
  )
  assert.deepEqual(
    reviewPullRequestIdentity(
      { number: 9, url: 'https://github.com/OpenAI/Codex/pull/9' },
      null
    ),
    {
      number: 9,
      repository: 'openai/codex',
      url: 'https://github.com/openai/codex/pull/9'
    }
  )
  assert.equal(reviewPullRequestIdentity({ number: 7 }, null), null)
  assert.equal(
    reviewPullRequestIdentity({
      number: 8,
      url: 'https://github.com/openai/codex/pull/9'
    }, null),
    null
  )
  assert.deepEqual(
    canonicalPullRequestMetadata(
      { number: 7, discovery: 'explicit' },
      { repositoryUrl: 'git@github.com:Lastobelus/Markover.git' }
    ),
    {
      number: 7,
      discovery: 'explicit',
      url: 'https://github.com/lastobelus/markover/pull/7'
    }
  )
})

test('accepts only the agent PR status vocabulary', () => {
  for (const value of ['draft', 'open', 'merged', 'closed']) {
    assert.equal(isPullRequestStatus(value), true)
  }
  for (const value of ['unknown', 'OPEN', null, 1]) {
    assert.equal(isPullRequestStatus(value), false)
  }
})

test('accepts PR observations only as a complete timestamped tuple', () => {
  const complete = {
    status: 'open',
    statusObservedAt: '2026-08-10T02:00:00.000Z',
    statusSource: 'agent'
  }
  assert.deepEqual(pullRequestObservation(complete), complete)
  assert.equal(hasPullRequestObservationFields(complete), true)
  assert.equal(pullRequestObservation({ status: 'open' }), null)
  assert.equal(pullRequestObservation({
    ...complete,
    statusObservedAt: 'not-a-date'
  }), null)
  assert.equal(hasPullRequestObservationFields({ number: 7 }), false)
})
