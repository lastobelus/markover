import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  stageCanonicalApplication
} from '../scripts/canonical-application'
import type {
  AddressedDevelopmentBundle
} from '../scripts/development-bundle'

async function fixture(t: TestContext): Promise<{
  address: AddressedDevelopmentBundle
  destinationPath: string
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-install-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const appPath = path.join(root, 'generated', 'Markover.app')
  const destinationPath = path.join(root, 'Applications', 'Markover.app')
  await fs.mkdir(path.join(appPath, 'Contents'), { recursive: true })
  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  await fs.writeFile(path.join(appPath, 'Contents', 'build.txt'), 'new')
  return {
    address: {
      appBundleId: 'com.lastobelus.markover.development.canonical',
      appName: 'Markover',
      appPath,
      bundleDirectory: path.dirname(appPath),
      generatedRoot: path.dirname(path.dirname(appPath)),
      helperBundleId: 'com.lastobelus.markover.development.canonical.helper',
      identityKey: 'canonical',
      scheme: 'markover'
    },
    destinationPath
  }
}

const acceptCopy = (): Promise<void> => Promise.resolve()

test('canonical installation stages and verifies before replacing Applications', async (t) => {
  const { address, destinationPath } = await fixture(t)
  await fs.mkdir(path.join(destinationPath, 'Contents'), { recursive: true })
  await fs.writeFile(path.join(destinationPath, 'Contents', 'build.txt'), 'old')
  let verifiedPath = ''
  const transaction = await stageCanonicalApplication(address, {
    destinationPath,
    randomSuffix: () => 'stage',
    verify(appPath) {
      verifiedPath = appPath
      return Promise.resolve()
    }
  })
  assert.equal(
    await fs.readFile(path.join(destinationPath, 'Contents', 'build.txt'), 'utf8'),
    'old'
  )
  assert.equal(verifiedPath, transaction.stagedPath)
  await transaction.replace()
  assert.equal(
    await fs.readFile(path.join(destinationPath, 'Contents', 'build.txt'), 'utf8'),
    'new'
  )
  assert.equal(
    await fs.readFile(path.join(transaction.backupPath, 'Contents', 'build.txt'), 'utf8'),
    'old'
  )
  await transaction.commit()
  await assert.rejects(fs.access(transaction.backupPath))
})

test('failed health can roll back the exact previous application', async (t) => {
  const { address, destinationPath } = await fixture(t)
  await fs.mkdir(path.join(destinationPath, 'Contents'), { recursive: true })
  await fs.writeFile(path.join(destinationPath, 'Contents', 'build.txt'), 'old')
  const transaction = await stageCanonicalApplication(address, {
    destinationPath,
    randomSuffix: () => 'rollback',
    verify: acceptCopy
  })
  await transaction.replace()
  await transaction.rollback()
  assert.equal(
    await fs.readFile(path.join(destinationPath, 'Contents', 'build.txt'), 'utf8'),
    'old'
  )
  await assert.rejects(fs.access(transaction.backupPath))
})

test('rollback removes a first installation when no prior app existed', async (t) => {
  const { address, destinationPath } = await fixture(t)
  const transaction = await stageCanonicalApplication(address, {
    destinationPath,
    randomSuffix: () => 'first',
    verify: acceptCopy
  })
  await transaction.replace()
  await transaction.rollback()
  await assert.rejects(fs.access(destinationPath))
})

test('failed staging leaves the installed application untouched', async (t) => {
  const { address, destinationPath } = await fixture(t)
  await fs.mkdir(path.join(destinationPath, 'Contents'), { recursive: true })
  await fs.writeFile(path.join(destinationPath, 'Contents', 'build.txt'), 'old')
  await assert.rejects(
    stageCanonicalApplication(address, {
      destinationPath,
      randomSuffix: () => 'invalid',
      verify: () => Promise.reject(new Error('invalid staged copy'))
    }),
    /invalid staged copy/
  )
  assert.equal(
    await fs.readFile(path.join(destinationPath, 'Contents', 'build.txt'), 'utf8'),
    'old'
  )
})

test('backup cleanup failure cannot roll back the verified replacement', async (t) => {
  const { address, destinationPath } = await fixture(t)
  await fs.mkdir(path.join(destinationPath, 'Contents'), { recursive: true })
  await fs.writeFile(path.join(destinationPath, 'Contents', 'build.txt'), 'old')
  const backupPath = path.join(
    path.dirname(destinationPath),
    `.Markover.app.previous-${String(process.pid)}-cleanup`
  )
  const transaction = await stageCanonicalApplication(address, {
    destinationPath,
    randomSuffix: () => 'cleanup',
    remove(filePath, options) {
      if (filePath === backupPath) {
        return Promise.reject(new Error('simulated cleanup failure'))
      }
      return fs.rm(filePath, options)
    },
    verify: acceptCopy
  })
  await transaction.replace()
  await assert.rejects(transaction.commit(), /previous application cleanup failed/)
  await transaction.rollback()
  assert.equal(
    await fs.readFile(path.join(destinationPath, 'Contents', 'build.txt'), 'utf8'),
    'new'
  )
})
