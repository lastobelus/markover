import fs from 'node:fs/promises'
import http, { type IncomingMessage } from 'node:http'

import {
  parseServiceCredential,
  parseServiceEndpoint,
  tokenPathForEndpoint,
  type ServiceCredential,
  type ServiceEndpoint
} from './service-endpoint'

const DEFAULT_RECORD_RETRY_DELAYS = [0, 10, 20, 40, 80] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class LocalServiceError extends Error {
  readonly code: string
  readonly statusCode: number | null | undefined

  constructor(
    code: string,
    message: string,
    statusCode: number | null | undefined = null
  ) {
    super(message)
    this.name = 'LocalServiceError'
    this.code = code
    this.statusCode = statusCode
  }
}

export async function readEndpoint(endpointPath: string): Promise<ServiceEndpoint> {
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(endpointPath, 'utf8'))
  } catch {
    throw new LocalServiceError(
      'INVALID_ENDPOINT',
      'Markover service metadata is invalid.'
    )
  }
  const endpoint = parseServiceEndpoint(value)
  if (!endpoint) {
    throw new LocalServiceError(
      'INVALID_ENDPOINT',
      'Markover service metadata is invalid.'
    )
  }
  return endpoint
}

async function readCredential(endpointPath: string): Promise<ServiceCredential> {
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(tokenPathForEndpoint(endpointPath), 'utf8'))
  } catch {
    throw new LocalServiceError(
      'INVALID_CREDENTIAL',
      'Markover service credentials are invalid.'
    )
  }
  const credential = parseServiceCredential(value)
  if (!credential) {
    throw new LocalServiceError(
      'INVALID_CREDENTIAL',
      'Markover service credentials are invalid.'
    )
  }
  return credential
}

interface ServiceConnection {
  credential: ServiceCredential
  endpoint: ServiceEndpoint
}

export interface ReadServiceConnectionOptions {
  retryDelaysMilliseconds?: readonly number[]
  wait?: (milliseconds: number) => Promise<void>
}

function isRetryableRecordError(error: unknown): boolean {
  return error instanceof LocalServiceError && (
    error.code === 'INVALID_ENDPOINT' ||
    error.code === 'INVALID_CREDENTIAL' ||
    error.code === 'STALE_SERVICE'
  )
}

export async function readServiceConnection(
  endpointPath: string,
  {
    retryDelaysMilliseconds = DEFAULT_RECORD_RETRY_DELAYS,
    wait = delay
  }: ReadServiceConnectionOptions = {}
): Promise<ServiceConnection> {
  let lastError: unknown = null
  for (const [index, delayMilliseconds] of retryDelaysMilliseconds.entries()) {
    if (index > 0 && delayMilliseconds > 0) await wait(delayMilliseconds)
    try {
      const endpoint = await readEndpoint(endpointPath)
      const credential = await readCredential(endpointPath)
      if (credential.instanceId !== endpoint.instanceId) {
        throw new LocalServiceError(
          'STALE_SERVICE',
          'Markover service metadata and credentials do not match.'
        )
      }
      return { credential, endpoint }
    } catch (error) {
      lastError = error
      if (
        !isRetryableRecordError(error) ||
        index === retryDelaysMilliseconds.length - 1
      ) {
        throw error
      }
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new LocalServiceError(
    'INVALID_ENDPOINT',
    'Markover service metadata is invalid.'
  )
}

interface HttpRequestOptions {
  body?: unknown
  credential?: ServiceCredential
  endpoint: ServiceEndpoint
  method: string
  requestPath: string
  requestFailureCode: 'REQUEST_UNCERTAIN' | 'SERVICE_UNAVAILABLE'
  requestFailureMessage: string
}

async function sendHttpJson({
  body = null,
  credential,
  endpoint,
  method,
  requestPath,
  requestFailureCode,
  requestFailureMessage
}: HttpRequestOptions): Promise<unknown> {
  const contents = body === null ? null : JSON.stringify(body)
  const headers: Record<string, string | number> = {}
  if (credential) headers.authorization = `Bearer ${credential.token}`
  if (contents !== null) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = Buffer.byteLength(contents)
  }

  return new Promise<unknown>((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: endpoint.port,
      method,
      path: requestPath,
      headers,
      timeout: 2000
    }, (response: IncomingMessage) => {
      response.setEncoding('utf8')
      let responseBody = ''
      response.on('data', (chunk: string) => {
        responseBody += chunk
      })
      response.on('end', () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(responseBody)
        } catch {
          reject(new LocalServiceError(
            'INVALID_RESPONSE',
            'Markover returned invalid JSON.',
            response.statusCode
          ))
          return
        }

        const statusCode = response.statusCode
        if (statusCode === undefined || statusCode < 200 || statusCode >= 300) {
          const error = isRecord(parsed) && isRecord(parsed.error)
            ? parsed.error
            : {}
          const code = typeof error.code === 'string'
            ? error.code
            : 'REQUEST_FAILED'
          const message = typeof error.message === 'string'
            ? error.message
            : `Markover returned ${String(statusCode)}.`
          reject(new LocalServiceError(code, message, statusCode))
          return
        }
        resolve(parsed)
      })
    })

    request.on('timeout', () => {
      request.destroy(new Error('Markover service request timed out.'))
    })
    request.on('error', () => {
      reject(new LocalServiceError(requestFailureCode, requestFailureMessage))
    })
    if (contents !== null) request.write(contents)
    request.end()
  })
}

async function readHealth(endpoint: ServiceEndpoint): Promise<unknown> {
  const health = await sendHttpJson({
    endpoint,
    method: 'GET',
    requestPath: '/health',
    requestFailureCode: 'SERVICE_UNAVAILABLE',
    requestFailureMessage: 'Markover service is unavailable.'
  })
  if (
    !isRecord(health) ||
    health.status !== 'ok' ||
    health.version !== 2 ||
    typeof health.instanceId !== 'string'
  ) {
    throw new LocalServiceError(
      'INVALID_RESPONSE',
      'Markover returned an invalid health response.',
      200
    )
  }
  if (health.instanceId !== endpoint.instanceId) {
    throw new LocalServiceError(
      'STALE_SERVICE',
      'Markover service identity does not match its metadata.',
      200
    )
  }
  return health
}

export async function probeService(
  endpointPath: string,
  options?: ReadServiceConnectionOptions
): Promise<ServiceConnection> {
  const connection = await readServiceConnection(endpointPath, options)
  await readHealth(connection.endpoint)
  return connection
}

export async function requestJson(
  endpointPath: string,
  method: string,
  requestPath: string,
  body: unknown = null
): Promise<unknown> {
  const isPublicHealth = method === 'GET' && requestPath === '/health'
  if (isPublicHealth) {
    const endpoint = await readEndpoint(endpointPath)
    return readHealth(endpoint)
  }

  const { credential, endpoint } = await probeService(endpointPath)
  return sendHttpJson({
    body,
    credential,
    endpoint,
    method,
    requestPath,
    requestFailureCode: 'REQUEST_UNCERTAIN',
    requestFailureMessage: (
      'The Markover request may not have completed. Inspect Markover before retrying.'
    )
  })
}
