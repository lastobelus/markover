import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  expectedStageEntries,
  verifyAppLayout
} from '../scripts/app-layout'

async function fixture(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-app-'))
  t.after(async () => fs.rm(directory, { recursive: true, force: true }))
  for (const entry of expectedStageEntries) {
    const filePath = path.join(directory, entry)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, '')
  }
  await fs.writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ main: 'src/main.js' })
  )
  await fs.writeFile(
    path.join(directory, 'build-identity.json'),
    JSON.stringify({
      version: '1.0.0',
      commit: null,
      dirty: false,
      rendererSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    })
  )
  await fs.writeFile(
    path.join(directory, 'src/index.html'),
    [
      '<meta http-equiv="Content-Security-Policy">',
      '<script src="startup.js"></script>',
      '<script type="module" src="renderer.js"></script>'
    ].join('\n')
  )
  return directory
}

test('application layout accepts only the declared runtime stage', async (t) => {
  const directory = await fixture(t)
  await verifyAppLayout(directory)

  await fs.writeFile(path.join(directory, 'src/accidental.ts'), '')
  await assert.rejects(
    verifyAppLayout(directory),
    /Unexpected: src\/accidental\.ts/
  )
})

test('application layout reports missing required files', async (t) => {
  const directory = await fixture(t)
  await fs.rm(path.join(directory, 'src/preload.js'))
  await assert.rejects(
    verifyAppLayout(directory),
    /Missing: src\/preload\.js/
  )
})

test('application layout rejects symlinks', async (t) => {
  const directory = await fixture(t)
  await fs.rm(path.join(directory, 'src/styles.css'))
  await fs.symlink('index.html', path.join(directory, 'src/styles.css'))
  await assert.rejects(
    verifyAppLayout(directory),
    /contains a symlink: src\/styles\.css/
  )
})

test('application layout binds build identity to renderer bytes', async (t) => {
  const directory = await fixture(t)
  await fs.appendFile(path.join(directory, 'src/renderer.js'), '\n// changed\n')
  await assert.rejects(
    verifyAppLayout(directory),
    /build identity is invalid/
  )
})

test('application layout verifies the emitted main-process closure', async (t) => {
  const directory = await fixture(t)
  await fs.writeFile(
    path.join(directory, 'src/main.js'),
    "require('./not-staged')\n"
  )
  await assert.rejects(
    verifyAppLayout(directory),
    /main requires missing src\/not-staged\.js/
  )
})

test('successful application builds reserve stdout for their caller', async () => {
  const buildSource = await fs.readFile(
    path.resolve('scripts/build-app.ts'),
    'utf8'
  )
  assert.doesNotMatch(buildSource, /process\.stdout/)
})
