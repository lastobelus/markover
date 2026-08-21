import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  WindowBoundsStore,
  clampWindowBounds,
  parseWindowBounds
} from '../src/window-bounds'

const workArea = { x: 0, y: 25, width: 1440, height: 875 }
const minimum = { width: 760, height: 520 }

test('parses only complete numeric bounds', () => {
  assert.deepEqual(
    parseWindowBounds({ x: 10, y: 20, width: 900, height: 700 }),
    { x: 10, y: 20, width: 900, height: 700, maximized: false }
  )
  assert.deepEqual(
    parseWindowBounds({ x: 10.6, y: 20.2, width: 900, height: 700, maximized: true }),
    { x: 11, y: 20, width: 900, height: 700, maximized: true }
  )
  assert.equal(parseWindowBounds(null), null)
  assert.equal(parseWindowBounds('1180x760'), null)
  assert.equal(parseWindowBounds({ x: 10, y: 20, width: 900 }), null)
  assert.equal(parseWindowBounds({ x: 10, y: 20, width: 0, height: 700 }), null)
  assert.equal(
    parseWindowBounds({ x: Number.NaN, y: 20, width: 900, height: 700 }),
    null
  )
})

test('fits remembered bounds back onto the current work area', () => {
  const unchanged = clampWindowBounds(
    { x: 100, y: 100, width: 1000, height: 700, maximized: false },
    workArea,
    minimum
  )
  assert.deepEqual(unchanged, {
    x: 100, y: 100, width: 1000, height: 700, maximized: false
  })

  // A window remembered on a display that is gone comes back on screen.
  const offscreen = clampWindowBounds(
    { x: 3000, y: 2000, width: 1000, height: 700, maximized: false },
    workArea,
    minimum
  )
  assert.equal(offscreen.x, workArea.x + workArea.width - 1000)
  assert.equal(offscreen.y, workArea.y + workArea.height - 700)

  // A smaller display shrinks the window rather than cropping it.
  const oversized = clampWindowBounds(
    { x: 0, y: 25, width: 4000, height: 3000, maximized: false },
    workArea,
    minimum
  )
  assert.equal(oversized.width, workArea.width)
  assert.equal(oversized.height, workArea.height)

  // The minimum still wins over a tiny remembered size.
  const tiny = clampWindowBounds(
    { x: 0, y: 25, width: 120, height: 90, maximized: true },
    workArea,
    minimum
  )
  assert.equal(tiny.width, minimum.width)
  assert.equal(tiny.height, minimum.height)
  assert.equal(tiny.maximized, true)
})

test('round-trips through the store and survives a missing or broken file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-window-'))
  const filePath = path.join(directory, 'window.json')
  const store = new WindowBoundsStore(filePath)

  assert.equal(await store.load(), null)

  store.save({ x: 12, y: 34, width: 1100, height: 720, maximized: false })
  await store.flush()

  const reopened = new WindowBoundsStore(filePath)
  assert.deepEqual(await reopened.load(), {
    x: 12, y: 34, width: 1100, height: 720, maximized: false
  })

  await fs.writeFile(filePath, '{ not json', 'utf8')
  assert.equal(await new WindowBoundsStore(filePath).load(), null)

  await fs.rm(directory, { recursive: true, force: true })
})
