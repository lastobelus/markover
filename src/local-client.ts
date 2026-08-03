import fs from 'node:fs/promises'
import http, { type IncomingMessage } from 'node:http'

interface ServiceEndpoint {
  version: 1
  port: number
}

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
  const endpoint: unknown = JSON.parse(await fs.readFile(endpointPath, 'utf8'))
  if (
    !isRecord(endpoint) ||
    endpoint.version !== 1 ||
    !Number.isInteger(endpoint.port) ||
    typeof endpoint.port !== 'number' ||
    endpoint.port < 1
  ) {
    throw new LocalServiceError(
      'INVALID_ENDPOINT',
      'Markover service metadata is invalid.'
    )
  }
  return { version: 1, port: endpoint.port }
}

export async function requestJson(
  endpointPath: string,
  method: string,
  requestPath: string,
  body: unknown = null
): Promise<unknown> {
  const endpoint = await readEndpoint(endpointPath)
  const contents = body === null ? null : JSON.stringify(body)

  return new Promise<unknown>((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: endpoint.port,
      method,
      path: requestPath,
      headers: contents === null
        ? {}
        : {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(contents)
          },
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
