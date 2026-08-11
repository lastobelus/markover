import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { discoverProjectFavicon } from '../src/project-favicon'

test('discovers a validated project favicon from conventional locations', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-favicon-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'public'))
  await fs.writeFile(
    path.join(root, 'public/favicon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>'
  )

  const source = await discoverProjectFavicon(root)
  assert.match(source || '', /^data:image\/svg\+xml;base64,/)
})

test('rejects executable SVG and malformed raster candidates', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-favicon-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'favicon.svg'), '<svg><script>alert(1)</script></svg>')
  await fs.writeFile(path.join(root, 'favicon.png'), 'not a png')

  assert.equal(await discoverProjectFavicon(root), null)
})
