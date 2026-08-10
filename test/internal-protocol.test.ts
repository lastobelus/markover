import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  InternalAttachmentAllowlist,
  parseInternalProtocolRequest,
  resolveInternalRequestFile
} from '../src/internal-protocol'
import {
  internalAttachmentUrl,
  internalRendererEntryUrl,
  MARKOVER_INTERNAL_SCHEME_PRIVILEGES,
  MARKOVER_RENDERER_ENTRY_URL
} from '../src/internal-url'
import { smokeReviewTree } from '../src/smoke-fixture'

function fixture(t: test.TestContext): {
  appRoot: string
  attachmentPath: string
  attachments: InternalAttachmentAllowlist
  reviewsRoot: string
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markover-protocol-'))
  t.after(() => { fs.rmSync(directory, { recursive: true, force: true }) })
  const appRoot = path.join(directory, 'app')
  const reviewsRoot = path.join(directory, 'reviews')
  const attachmentDirectory = path.join(
    reviewsRoot,
    'mko_abcdef',
    'attachments'
  )
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true })
  fs.mkdirSync(attachmentDirectory, { recursive: true })
  fs.writeFileSync(path.join(appRoot, 'src/index.html'), '<!doctype html>')
  const attachmentPath = path.join(attachmentDirectory, 'img-1.png')
  fs.writeFileSync(attachmentPath, 'image')
  return {
    appRoot,
    attachmentPath,
    attachments: new InternalAttachmentAllowlist(reviewsRoot),
    reviewsRoot
  }
}

test('internal URLs use one exact origin and stable attachment identities', () => {
  assert.deepEqual(MARKOVER_INTERNAL_SCHEME_PRIVILEGES, {
    secure: true,
    standard: true
  })
  assert.equal(
    internalRendererEntryUrl({ palette: 'ember', appearance: 'dark' }),
    `${MARKOVER_RENDERER_ENTRY_URL}?palette=ember&appearance=dark`
  )
  assert.equal(
    internalAttachmentUrl('mko_abcdef', 'img-2'),
    'markover-app://app/reviews/mko_abcdef/attachments/img-2'
  )
  assert.throws(() => internalAttachmentUrl('../outside', 'img-2'), /review ID/)
  assert.throws(() => internalAttachmentUrl('mko_abcdef', '../outside'), /attachment ID/)
})

test('protocol routing accepts only renderer assets and scoped attachment URLs', () => {
  assert.deepEqual(
    parseInternalProtocolRequest(
      `${MARKOVER_RENDERER_ENTRY_URL}?palette=ember`
    ),
    { kind: 'asset', relativePath: 'src/index.html' }
  )
  assert.deepEqual(
    parseInternalProtocolRequest(
      internalAttachmentUrl('mko_abcdef', 'img-1')
    ),
    { kind: 'attachment', reviewId: 'mko_abcdef', attachmentId: 'img-1' }
  )
  for (const forged of [
    'markover-app://other/src/index.html',
    'markover-app://user@app/src/index.html',
    'markover-app://app/src/main.js',
    'markover-app://app/../package.json',
    'markover-app://app/%2e%2e%2fpackage.json',
    'markover-app://app/src/renderer.js?forged=1',
    'markover-app://app/reviews/mko_abcdef/attachments/img-1?forged=1',
    'file:///tmp/index.html'
  ]) {
    assert.equal(parseInternalProtocolRequest(forged), null, forged)
  }
})

test('request resolution rejects missing and non-allowlisted files', async (t) => {
  const { appRoot, attachments } = fixture(t)
  assert.deepEqual(
    await resolveInternalRequestFile(
      MARKOVER_RENDERER_ENTRY_URL,
      appRoot,
      attachments
    ),
    { ok: true, filePath: path.join(appRoot, 'src/index.html') }
  )
  assert.deepEqual(
    await resolveInternalRequestFile(
      'markover-app://app/src/renderer.js',
      appRoot,
      attachments
    ),
    { ok: false, status: 404 }
  )
  assert.deepEqual(
    await resolveInternalRequestFile(
      'markover-app://app/src/main.js',
      appRoot,
      attachments
    ),
    { ok: false, status: 400 }
  )
})

test('attachment allowlist accepts only exact files inside the addressed review', async (t) => {
  const { appRoot, attachmentPath, attachments, reviewsRoot } = fixture(t)
  const tree = smokeReviewTree(attachmentPath)
  attachments.replaceReview('mko_abcdef', tree)
  const url = internalAttachmentUrl('mko_abcdef', 'img-1')
  assert.deepEqual(
    await resolveInternalRequestFile(url, appRoot, attachments),
    { ok: true, filePath: fs.realpathSync(attachmentPath) }
  )

  const outside = path.join(path.dirname(reviewsRoot), 'secret.png')
  fs.writeFileSync(outside, 'secret')
  assert.equal(attachments.register('mko_abcdef', 'img-2', outside), false)
  assert.deepEqual(
    await resolveInternalRequestFile(
      internalAttachmentUrl('mko_abcdef', 'img-2'),
      appRoot,
      attachments
    ),
    { ok: false, status: 404 }
  )

  attachments.remove('mko_abcdef', 'img-1')
  assert.deepEqual(
    await resolveInternalRequestFile(url, appRoot, attachments),
    { ok: false, status: 404 }
  )
})

test('attachment allowlist rejects symlinks that escape the review directory', async (t) => {
  const { appRoot, attachments, reviewsRoot } = fixture(t)
  const outside = path.join(path.dirname(reviewsRoot), 'outside.png')
  fs.writeFileSync(outside, 'secret')
  const link = path.join(reviewsRoot, 'mko_abcdef', 'attachments', 'img-2.png')
  fs.symlinkSync(outside, link)
  assert.equal(attachments.register('mko_abcdef', 'img-2', link), true)
  assert.deepEqual(
    await resolveInternalRequestFile(
      internalAttachmentUrl('mko_abcdef', 'img-2'),
      appRoot,
      attachments
    ),
    { ok: false, status: 404 }
  )
})
