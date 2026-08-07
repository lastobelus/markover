#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { ensureService, executeCommand } from './markover'
import { readEndpoint, requestJson } from '../src/local-client'
import {
  parseServiceCredential,
  createServiceIdentity,
  serviceEndpointPath,
  tokenPathForEndpoint
} from '../src/service-endpoint'

interface SmokeState {
  reviewId: string
  instanceId: string
  tokenDigest: string
}

export interface HappyPathSmokeOptions {
  endpointPath: string
  sourceContent: string
  sourcePath: string
  contextSummary: string
}

export interface HappyPathSmokeResult {
  reviewId: string
  status: 'editing'
}

export interface AuthorizationSmokeOptions {
  endpointPath?: string
  repairService?: (() => Promise<void>) | undefined
  statePath?: string
}

const defaultStatePath = path.join(
  os.tmpdir(),
  `markover-auth-smoke-${String(process.getuid?.() ?? 'user')}.json`
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'ascii').digest('hex')
}

export async function openHappyPathSmokeReview({
  endpointPath,
  sourceContent,
  sourcePath,
  contextSummary
}: HappyPathSmokeOptions): Promise<HappyPathSmokeResult> {
  await fs.writeFile(sourcePath, sourceContent, { mode: 0o600 })
  const opened = await executeCommand({
    command: 'open',
    sourcePath,
    contextSummary,
    branch: null,
    handoffKey: null,
    pullRequestNumber: null,
    threadId: null
  }, {
    endpointPath,
    ensure: () => Promise.resolve(),
    discoverMetadata: () => Promise.resolve({
      git: null,
      agentThread: null,
      pullRequest: null
    })
  })
  if (
    !isRecord(opened) ||
    typeof opened.reviewId !== 'string' ||
    opened.status !== 'editing'
  ) {
    throw new Error('Smoke review was not created.')
  }
  return {
    reviewId: opened.reviewId,
    status: 'editing'
  }
}

export async function handoffAndReopenHappyPathSmokeReview(
  endpointPath: string,
  reviewId: string
): Promise<HappyPathSmokeResult> {
  const handedOff = await executeCommand({
    command: 'get',
    reviewId
  }, {
    endpointPath,
    ensure: () => Promise.resolve()
  })
  if (
    !isRecord(handedOff) ||
    !isRecord(handedOff.review) ||
    handedOff.review.id !== reviewId ||
    handedOff.review.status !== 'pending-agent'
  ) {
    throw new Error('Smoke get did not return the prepared review.')
  }
  const edited = await executeCommand({
    command: 'edit',
    reviewId
  }, {
    endpointPath,
    ensure: () => Promise.resolve()
  })
  if (
    !isRecord(edited) ||
    edited.reviewId !== reviewId ||
    edited.status !== 'editing'
  ) {
    throw new Error('Smoke edit did not reopen the prepared review.')
  }
  return { reviewId, status: 'editing' }
}

async function readConnection(endpointPath: string) {
  const endpoint = await readEndpoint(endpointPath)
  let value: unknown
  try {
    value = JSON.parse(
      await fs.readFile(tokenPathForEndpoint(endpointPath), 'utf8')
    )
  } catch {
    throw new Error('Markover service credentials are unreadable.')
  }
  const credential = parseServiceCredential(value)
  if (!credential) throw new Error('Markover service credentials are invalid.')
  if (credential.instanceId !== endpoint.instanceId) {
    throw new Error('Markover service metadata and credentials do not match.')
  }
  return { credential, endpoint }
}

async function verifyPosixModes(endpointPath: string): Promise<void> {
  if (process.platform === 'win32') return
  const expected = [
    [path.dirname(endpointPath), 0o700],
    [endpointPath, 0o600],
    [tokenPathForEndpoint(endpointPath), 0o600]
  ] as const
  for (const [targetPath, expectedMode] of expected) {
    const actualMode = (await fs.stat(targetPath)).mode & 0o777
    if (actualMode !== expectedMode) {
      throw new Error(
        `${targetPath} has mode ${actualMode.toString(8)}; expected ${expectedMode.toString(8)}.`
      )
    }
  }
}

async function verifyUnauthorizedDenial(port: number): Promise<void> {
  const result = await new Promise<{
    body: unknown
    statusCode: number | undefined
    authenticate: string | undefined
  }>((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/reviews?authorization-smoke=redacted',
      timeout: 2000
    }, (response) => {
      response.setEncoding('utf8')
      let contents = ''
      response.on('data', (chunk: string) => { contents += chunk })
      response.on('end', () => {
        let body: unknown
        try {
          body = JSON.parse(contents)
        } catch {
          reject(new Error('Unauthorized smoke response was not valid JSON.'))
          return
        }
        resolve({
          body,
          statusCode: response.statusCode,
          authenticate: response.headers['www-authenticate']
        })
      })
    })
    request.on('timeout', () => {
      request.destroy(new Error('Unauthorized smoke request timed out.'))
    })
    request.on('error', reject)
    request.end()
  })
  if (
    result.statusCode !== 401 ||
    result.authenticate !== 'Bearer realm="Markover"' ||
    !isRecord(result.body) ||
    !isRecord(result.body.error) ||
    result.body.error.code !== 'UNAUTHORIZED' ||
    result.body.error.message !== 'Authentication required.'
  ) {
    throw new Error('Markover did not return the generic authorization denial.')
  }
}

function parseSmokeState(value: unknown): SmokeState {
  if (
    !isRecord(value) ||
    typeof value.reviewId !== 'string' ||
    !value.reviewId ||
    typeof value.instanceId !== 'string' ||
    !value.instanceId ||
    typeof value.tokenDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.tokenDigest)
  ) {
    throw new Error('Authorization smoke state is invalid.')
  }
  return {
    reviewId: value.reviewId,
    instanceId: value.instanceId,
    tokenDigest: value.tokenDigest
  }
}

export async function prepareAuthorizationSmoke({
  endpointPath = serviceEndpointPath(),
  repairService,
  statePath = defaultStatePath
}: AuthorizationSmokeOptions = {}) {
  const stateHandle = await fs.open(statePath, 'wx', 0o600).catch((error: unknown) => {
    if (
      error !== null &&
      typeof error === 'object' &&
      Reflect.get(error, 'code') === 'EEXIST'
    ) {
      throw new Error(
        `Authorization smoke state already exists at ${statePath}; verify it before preparing another review.`
      )
    }
    throw error
  })
  const sourcePath = `${statePath}.md`
  try {
    await verifyPosixModes(endpointPath)
    const initial = await readConnection(endpointPath)
    const mismatchedIdentity = createServiceIdentity()
    await fs.writeFile(
      tokenPathForEndpoint(endpointPath),
      `${JSON.stringify({
        version: 1,
        instanceId: mismatchedIdentity.instanceId,
        token: initial.credential.token
      }, null, 2)}\n`,
      { mode: 0o600 }
    )
    if (process.platform !== 'win32') {
      await fs.chmod(tokenPathForEndpoint(endpointPath), 0o600)
    }
    await (repairService || (() => ensureService({ endpointPath })))()
    const { credential, endpoint } = await readConnection(endpointPath)
    if (
      endpoint.instanceId !== initial.endpoint.instanceId ||
      credential.token !== initial.credential.token
    ) {
      throw new Error('Markover rotated its identity during in-place repair.')
    }
    await requestJson(endpointPath, 'GET', '/health')
    await verifyUnauthorizedDenial(endpoint.port)
    const opened = await openHappyPathSmokeReview({
      endpointPath,
      sourcePath,
      sourceContent: [
        '# Markover authorization smoke review',
        '',
        'This real review was created by `npm run smoke:auth -- prepare`.',
        'It is intentionally preserved as protocol-v2 smoke evidence.',
        ''
      ].join('\n'),
      contextSummary: 'Authorization smoke fixture — safe to preserve.'
    })
    const state: SmokeState = {
      reviewId: opened.reviewId,
      instanceId: endpoint.instanceId,
      tokenDigest: tokenDigest(credential.token)
    }
    await stateHandle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await stateHandle.sync()
    if (process.platform !== 'win32') await stateHandle.chmod(0o600)
    await stateHandle.close()
    return {
      phase: 'prepare',
      status: 'restart-required',
      reviewId: state.reviewId,
      recordsRepaired: true,
      statePath
    }
  } catch (error) {
    await stateHandle.close().catch(() => {})
    await fs.unlink(statePath).catch(() => {})
    throw error
  } finally {
    await fs.unlink(sourcePath).catch(() => {})
  }
}

export async function verifyAuthorizationSmoke({
  endpointPath = serviceEndpointPath(),
  statePath = defaultStatePath
}: AuthorizationSmokeOptions = {}) {
  const state = parseSmokeState(
    JSON.parse(await fs.readFile(statePath, 'utf8'))
  )
  await verifyPosixModes(endpointPath)
  const { credential, endpoint } = await readConnection(endpointPath)
  await requestJson(endpointPath, 'GET', '/health')
  if (endpoint.instanceId === state.instanceId) {
    throw new Error('Markover instance ID did not rotate after restart.')
  }
  if (tokenDigest(credential.token) === state.tokenDigest) {
    throw new Error('Markover authorization token did not rotate after restart.')
  }

  await handoffAndReopenHappyPathSmokeReview(endpointPath, state.reviewId)
  await fs.unlink(statePath)
  return {
    phase: 'verify',
    status: 'ok',
    reviewId: state.reviewId,
    instanceRotated: true,
    tokenRotated: true
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  try {
    const [phase, ...remaining] = args
    if (remaining.length || (phase !== 'prepare' && phase !== 'verify')) {
      throw new Error('Usage: npm run smoke:auth -- <prepare|verify>')
    }
    const result = phase === 'prepare'
      ? await prepareAuthorizationSmoke()
      : await verifyAuthorizationSmoke()
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (require.main === module) void main()
