import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  prepareAuthorizationSmoke,
  verifyAuthorizationSmoke
} from '../scripts/smoke-auth'
import { startLocalService, type LocalService } from '../src/local-service'
import { ReviewStore } from '../src/review-store'
import {
  createServiceIdentity,
  publishServiceConnection
} from '../src/service-endpoint'

test('smoke fixture proves restart rotation and CLI open/get/edit', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'markover-auth-smoke-test-')
  )
  const endpointPath = path.join(directory, 'service.json')
  const statePath = path.join(directory, 'smoke-state.json')
  const store = new ReviewStore(path.join(directory, 'reviews'), {
    idFactory: () => 'mko_smoke001'
  })
  let service: LocalService | null = null
  t.after(async () => {
    if (service) await service.close()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const start = async () => {
    const identity = createServiceIdentity()
    const startedService = await startLocalService({
      identity,
      store
    })
    service = startedService
    await publishServiceConnection({
      endpointPath,
      identity,
      port: startedService.port,
      pid: 1234
    })
    return { identity, service: startedService }
  }

  const first = await start()
  const firstIdentity = first.identity
  let repairCalls = 0
  assert.deepEqual(
    await prepareAuthorizationSmoke({
      endpointPath,
      statePath,
      async repairService() {
        repairCalls += 1
        await publishServiceConnection({
          endpointPath,
          identity: firstIdentity,
          port: first.service.port,
          pid: 1234
        })
      }
    }),
    {
      phase: 'prepare',
      status: 'restart-required',
      reviewId: 'mko_smoke001',
      recordsRepaired: true,
      statePath
    }
  )
  assert.equal(repairCalls, 1)
  const persisted: unknown = JSON.parse(await fs.readFile(statePath, 'utf8'))
  assert.deepEqual(Object.keys(persisted as Record<string, unknown>), [
    'reviewId',
    'instanceId',
    'tokenDigest'
  ])
  assert.equal((persisted as Record<string, unknown>).instanceId, firstIdentity.instanceId)
  assert.equal(JSON.stringify(persisted).includes(firstIdentity.token), false)
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(statePath)).mode & 0o777, 0o600)
  }

  await assert.rejects(
    verifyAuthorizationSmoke({ endpointPath, statePath }),
    /instance ID did not rotate/
  )
  assert.ok(await fs.stat(statePath))

  await first.service.close()
  service = null
  const secondIdentity = (await start()).identity
  assert.notEqual(secondIdentity.instanceId, firstIdentity.instanceId)
  assert.notEqual(secondIdentity.token, firstIdentity.token)
  assert.deepEqual(
    await verifyAuthorizationSmoke({ endpointPath, statePath }),
    {
      phase: 'verify',
      status: 'ok',
      reviewId: 'mko_smoke001',
      instanceRotated: true,
      tokenRotated: true
    }
  )
  await assert.rejects(fs.stat(statePath), { code: 'ENOENT' })
  const artifact = await store.load('mko_smoke001')
  assert.equal(artifact.review.status, 'editing')
  assert.match(
    artifact.sourceDocument.content,
    /Markover authorization smoke review/
  )
})
