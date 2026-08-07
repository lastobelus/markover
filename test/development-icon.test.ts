import assert from 'node:assert/strict'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  developmentIconPaths,
  generateDevelopmentIcon,
  watermarkedIconSvg
} from '../scripts/generate-development-icon'
import type { IconCommandRunner } from '../scripts/build-macos-icon'

const projectRoot = path.resolve(__dirname, '../..')

test('watermarked development icons retain the source and add the PR number', async () => {
  const source = await fs.readFile(path.join(
    projectRoot,
    'design/brand/markover-app-icon.svg'
  ), 'utf8')
  const result = watermarkedIconSvg(source, 61)
  assert.match(result, /id="markover-development-watermark"/)
  assert.match(result, /aria-label="Pull request 61"/)
  assert.match(result, />61<\/text>/)
  assert.match(result, /fill="#075b7a"/)
  assert.equal(result.endsWith('</svg>\n'), true)
  assert.equal(result.indexOf('<path'), source.indexOf('<path'))
})

test('development icon paths match the resolver branding contract', () => {
  const paths = developmentIconPaths('/checkouts/pr-42', 42)
  assert.deepEqual(paths, {
    directory: '/checkouts/pr-42/.markover/generated/pr-42',
    manifest: '/checkouts/pr-42/.markover/generated/pr-42/manifest.json',
    svg: '/checkouts/pr-42/.markover/generated/pr-42/markover-app-icon.svg',
    png: '/checkouts/pr-42/.markover/generated/pr-42/markover-app-icon.png',
    icns: '/checkouts/pr-42/.markover/generated/pr-42/markover-app-icon.icns'
  })
})

test('development icon assets are generated lazily and invalidated by source changes', async (t) => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-icon-'))
  t.after(() => fs.rm(checkout, { recursive: true, force: true }))
  const sourcePath = path.join(checkout, 'icon.svg')
  await fs.writeFile(sourcePath, '<svg viewBox="0 0 1024 1024"></svg>\n')
  let commandCount = 0
  const fakeRunner: IconCommandRunner = (command, args) => {
    commandCount += 1
    const outputFlag = command.endsWith('iconutil') ? '-o' : '--out'
    const outputIndex = args.indexOf(outputFlag)
    const output = outputIndex === -1 ? undefined : args[outputIndex + 1]
    assert.ok(output)
    fsSync.mkdirSync(path.dirname(output), { recursive: true })
    fsSync.writeFileSync(
      output,
      command.endsWith('iconutil') ? 'icns' : 'png'
    )
  }

  const first = await generateDevelopmentIcon({
    checkout,
    pullRequestNumber: 42,
    platform: 'darwin',
    runCommand: fakeRunner,
    sourceSvgPath: sourcePath
  })
  assert.equal(first.cached, false)
  assert.equal(commandCount, 12)
  assert.match(await fs.readFile(first.paths.svg, 'utf8'), />42<\/text>/)

  const cached = await generateDevelopmentIcon({
    checkout,
    pullRequestNumber: 42,
    platform: 'darwin',
    runCommand: fakeRunner,
    sourceSvgPath: sourcePath
  })
  assert.equal(cached.cached, true)
  assert.equal(commandCount, 12)

  await fs.appendFile(sourcePath, '<!-- changed -->\n')
  const regenerated = await generateDevelopmentIcon({
    checkout,
    pullRequestNumber: 42,
    platform: 'darwin',
    runCommand: fakeRunner,
    sourceSvgPath: sourcePath
  })
  assert.equal(regenerated.cached, false)
  assert.equal(commandCount, 24)
})

test('development icon generation rejects invalid pull-request numbers', () => {
  assert.throws(
    () => watermarkedIconSvg('<svg></svg>', 0),
    /pull-request number/
  )
})
