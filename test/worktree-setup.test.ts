import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(__dirname, '../..')

test('T3 imports setup and resumable validation actions', async () => {
  const projectFile: unknown = JSON.parse(await fs.readFile(
    path.join(projectRoot, 't3.json'),
    'utf8'
  ))
  assert.deepEqual(projectFile, {
    $schema: 'https://t3.codes/schema/t3.json',
    scripts: [
      {
        name: 'Setup Worktree',
        command: './scripts/setup-worktree.sh',
        icon: 'configure',
        runOnWorktreeCreate: true
      },
      {
        name: 'Wait for PR',
        command: 'npm run build --silent && node build/scripts/markover-wait-for-pr.js',
        icon: 'test'
      },
      {
        name: 'Run Local CI',
        command: 'node scripts/markover-local-ci-bootstrap.js',
        icon: 'test'
      },
      {
        name: 'Start Dev Build',
        command: 'node scripts/markover-start-dev-build.js --instance dev --await-human',
        icon: 'test'
      }
    ]
  })
})

test('worktree setup installs dependencies, seeds once, and preserves edits', async (t) => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-setup-'))
  t.after(() => fs.rm(checkout, { recursive: true, force: true }))
  await fs.mkdir(path.join(checkout, 'scripts'))
  await fs.mkdir(path.join(checkout, 'config'))
  await fs.copyFile(
    path.join(projectRoot, 'scripts/setup-worktree.sh'),
    path.join(checkout, 'scripts/setup-worktree.sh')
  )
  await fs.copyFile(
    path.join(projectRoot, 'config/development.defaults.json'),
    path.join(checkout, 'config/development.defaults.json')
  )
  assert.equal(spawnSync('git', ['init', '-q'], {
    cwd: checkout,
    encoding: 'utf8'
  }).status, 0)

  const binaryDirectory = path.join(checkout, 'test-bin')
  const npmLog = path.join(checkout, 'npm.log')
  await fs.mkdir(binaryDirectory)
  const fakeNpm = path.join(binaryDirectory, 'npm')
  await fs.writeFile(fakeNpm, [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$MARKOVER_TEST_NPM_LOG"',
    ''
  ].join('\n'))
  await fs.chmod(fakeNpm, 0o755)
  const environment = {
    ...process.env,
    PATH: `${binaryDirectory}:${process.env.PATH || ''}`,
    MARKOVER_TEST_NPM_LOG: npmLog
  }
  const setup = path.join(checkout, 'scripts/setup-worktree.sh')
  const runSetup = () => spawnSync('/bin/sh', [setup], {
    cwd: checkout,
    encoding: 'utf8',
    env: environment
  })

  assert.equal(runSetup().status, 0)
  const developmentConfig = path.join(checkout, '.markover/development.json')
  assert.deepEqual(
    JSON.parse(await fs.readFile(developmentConfig, 'utf8')),
    JSON.parse(await fs.readFile(
      path.join(checkout, 'config/development.defaults.json'),
      'utf8'
    ))
  )
  await fs.writeFile(developmentConfig, '{"customized":true}\n')
  assert.equal(runSetup().status, 0)
  assert.equal(await fs.readFile(developmentConfig, 'utf8'), '{"customized":true}\n')
  assert.equal(await fs.readFile(npmLog, 'utf8'), 'ci\nci\n')
})
