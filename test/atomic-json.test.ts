import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { replaceJsonFile } from '../src/atomic-json'

test('atomically replaces private pretty-printed JSON without temporary files', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-atomic-json-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'state.json')
  await fs.writeFile(filePath, '{}\n', { mode: 0o666 })

  await replaceJsonFile(filePath, { current: true })

  assert.equal(await fs.readFile(filePath, 'utf8'), '{\n  "current": true\n}\n')
  assert.deepEqual(await fs.readdir(directory), ['state.json'])
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600)
  }
})

test('preserves the destination when JSON serialization fails before replacement', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-atomic-json-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const filePath = path.join(directory, 'state.json')
  await fs.writeFile(filePath, '{"current":true}\n')

  await assert.rejects(replaceJsonFile(filePath, { unsupported: 1n }), TypeError)

  assert.equal(await fs.readFile(filePath, 'utf8'), '{"current":true}\n')
  assert.deepEqual(await fs.readdir(directory), ['state.json'])
})

test('cleans the private temporary file when rename fails', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-atomic-json-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const destination = path.join(directory, 'state.json')
  await fs.mkdir(destination)

  await assert.rejects(replaceJsonFile(destination, { current: true }))

  assert.deepEqual(await fs.readdir(directory), ['state.json'])
  assert.deepEqual(await fs.readdir(destination), [])
})
