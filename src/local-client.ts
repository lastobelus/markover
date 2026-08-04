import fs from 'node:fs/promises'
import http, { type IncomingMessage } from 'node:http'

import {
  parseServiceCredential,
  parseServiceEndpoint,
  tokenPathForEndpoint,
  type ServiceEndpoint
} from './service-endpoint'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

async function readCredential(endpointPath: string) {
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

export async function requestJson(
  endpointPath: string,
  method: string,
  requestPath: string,
  body: unknown = null
): Promise<unknown> {
  const endpoint = await readEndpoint(endpointPath)
  const isPublicHealth = method === 'GET' && requestPath === '/health'
  const credential = isPublicHealth ? null : await readCredential(endpointPath)
  if (credential && credential.instanceId !== endpoint.instanceId) {
    throw new LocalServiceError(
      'STALE_SERVICE',
      'Markover service metadata and credentials do not match.'
    )
  }
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
          reject(new LocalServiceError(
            code,
            message,
            statusCode
          ))
          return
        }
        if (
          isPublicHealth &&
          (!isRecord(parsed) || parsed.status !== 'ok' || parsed.version !== 2)
        ) {
          reject(new LocalServiceError(
            'INVALID_RESPONSE',
            'Markover returned an invalid health response.',
            statusCode
          ))
          return
        }
        resolve(parsed)
      })
    })

    request.on('timeout', () => {
      request.destroy(new Error('Markover service request timed out.'))
    })
    request.on('error', reject)
    if (contents !== null) request.write(contents)
    request.end()
  })
}
