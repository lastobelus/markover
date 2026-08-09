import assert from 'node:assert/strict'
import test from 'node:test'

import {
  openPublicLinkCommand,
  type PublicLinkOpenDependencies
} from '../src/public-link-opener'
import { PUBLIC_LINKS, type PublicLink } from '../src/public-links'

function dependencies(
  overrides: Partial<PublicLinkOpenDependencies> = {}
): PublicLinkOpenDependencies {
  return {
    copyText: () => {},
    openExternal: () => Promise.resolve(),
    restoreFocus: () => {},
    showFailure: () => Promise.resolve('dismiss'),
    ...overrides
  }
}

test('each public command opens only its canonical destination', async () => {
  const opened: string[] = []
  let failureCount = 0
  let focusCount = 0
  const deps = dependencies({
    openExternal(url) {
      opened.push(url)
      return Promise.resolve()
    },
    restoreFocus() { focusCount += 1 },
    showFailure() {
      failureCount += 1
      return Promise.resolve('dismiss')
    }
  })

  for (const link of PUBLIC_LINKS) {
    await openPublicLinkCommand(link.id, deps)
  }

  assert.deepEqual(opened, PUBLIC_LINKS.map((link) => link.url))
  assert.equal(failureCount, 0)
  assert.equal(focusCount, 0)
})

test('a launch rejection can copy the exact link and restores focus', async () => {
  const failure = new Error('No application found to open URL')
  const copied: string[] = []
  const shown: Array<{ link: PublicLink, error: unknown }> = []
  let focusCount = 0
  await openPublicLinkCommand('user-guide', dependencies({
    copyText(text) { copied.push(text) },
    openExternal: () => Promise.reject(failure),
    restoreFocus() { focusCount += 1 },
    showFailure(link, error) {
      shown.push({ link, error })
      return Promise.resolve('copy')
    }
  }))

  assert.deepEqual(copied, [PUBLIC_LINKS[0].url])
  assert.deepEqual(shown, [{ link: PUBLIC_LINKS[0], error: failure }])
  assert.equal(focusCount, 1)
})

test('dismissing a launch rejection does not copy but restores focus', async () => {
  let copied = false
  let focusCount = 0
  await openPublicLinkCommand('privacy-and-local-data', dependencies({
    copyText() { copied = true },
    openExternal: () => Promise.reject(new Error('offline')),
    restoreFocus() { focusCount += 1 }
  }))

  assert.equal(copied, false)
  assert.equal(focusCount, 1)
})

test('focus is restored even if failure feedback itself fails', async () => {
  let focusCount = 0
  await assert.rejects(
    openPublicLinkCommand('ask-for-help', dependencies({
      openExternal: () => Promise.reject(new Error('launch failed')),
      restoreFocus() { focusCount += 1 },
      showFailure: () => Promise.reject(new Error('dialog failed'))
    })),
    /dialog failed/
  )
  assert.equal(focusCount, 1)
})

test('unknown public-link IDs are rejected before opening anything', async () => {
  let opened = false
  await assert.rejects(
    openPublicLinkCommand('arbitrary-url' as never, dependencies({
      openExternal() {
        opened = true
        return Promise.resolve()
      }
    })),
    /Unknown public link/
  )
  assert.equal(opened, false)
})
