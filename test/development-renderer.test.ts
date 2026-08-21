import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  buildDevelopmentRenderer,
  type DevelopmentRendererBuild
} from '../scripts/development-renderer'

async function fixture(t: TestContext): Promise<{
  project: string
  published: string
}> {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-renderer-'))
  t.after(() => fs.rm(project, { recursive: true, force: true }))
  for (const input of [
    'src/index.html',
    'src/styles.css',
    'design/brand/markover-app-icon.png',
    'design/brand/markover-lockup.svg',
    'design/brand/markover-logotype.svg',
    'design/brand/markover-mark.svg'
  ]) {
    await fs.mkdir(path.dirname(path.join(project, input)), { recursive: true })
    await fs.writeFile(path.join(project, input), input)
  }
  return { project, published: path.join(project, 'identity', 'renderer') }
}

function fakeBuild(inputs: readonly string[]): DevelopmentRendererBuild {
  return async (options) => {
    assert.equal(options.metafile, true)
    const outfile = String(options.outfile)
    await fs.mkdir(path.dirname(outfile), { recursive: true })
    await fs.writeFile(outfile, `built ${String(options.format)}`)
    await fs.writeFile(`${outfile}.map`, 'map')
    return {
      errors: [],
      warnings: [],
      metafile: {
        inputs: Object.fromEntries(inputs.map((input) => [input, { bytes: 1, imports: [] }])),
        outputs: {}
      }
    }
  }
}

test('publishes a complete renderer directory and normalized input paths', async (t) => {
  const { project, published } = await fixture(t)
  const result = await buildDevelopmentRenderer({
    build: fakeBuild(['src/shared.ts', path.join(project, 'src', 'absolute.ts')]),
    projectDirectory: project,
    publishedDirectory: published
  })

  assert.equal(result.publishedDirectory, published)
  assert.deepEqual(result.inputPaths, [
    'design/brand/markover-app-icon.png',
    'design/brand/markover-lockup.svg',
    'design/brand/markover-logotype.svg',
    'design/brand/markover-mark.svg',
    'src/absolute.ts',
    'src/index.html',
    'src/shared.ts',
    'src/styles.css'
  ])
  assert.equal(await fs.readFile(path.join(published, 'src/preload.js'), 'utf8'), 'built cjs')
  assert.equal(await fs.readFile(path.join(published, 'src/startup.js'), 'utf8'), 'built iife')
  assert.equal(await fs.readFile(path.join(published, 'src/renderer.js'), 'utf8'), 'built esm')
  assert.equal(await fs.readFile(path.join(published, 'src/index.html'), 'utf8'), 'src/index.html')
  assert.equal(
    await fs.readFile(path.join(published, 'design/brand/markover-mark.svg'), 'utf8'),
    'design/brand/markover-mark.svg'
  )
})

test('a failed build preserves the previously published renderer', async (t) => {
  const { project, published } = await fixture(t)
  await fs.mkdir(published, { recursive: true })
  await fs.writeFile(path.join(published, 'current'), 'keep me')
  let calls = 0
  const failingBuild: DevelopmentRendererBuild = async (options) => {
    calls += 1
    if (calls === 2) throw new Error('startup did not bundle')
    return fakeBuild(['src/preload.ts'])(options)
  }

  await assert.rejects(
    buildDevelopmentRenderer({
      build: failingBuild,
      projectDirectory: project,
      publishedDirectory: published
    }),
    /startup did not bundle/
  )
  assert.equal(await fs.readFile(path.join(published, 'current'), 'utf8'), 'keep me')
  assert.deepEqual(await fs.readdir(path.dirname(published)), ['renderer'])
})
