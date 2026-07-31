const fs = require('node:fs/promises')
const http = require('node:http')

class LocalServiceError extends Error {
  constructor(code, message, statusCode = null) {
    super(message)
    this.name = 'LocalServiceError'
    this.code = code
    this.statusCode = statusCode
  }
}

async function readEndpoint(endpointPath) {
  const endpoint = JSON.parse(await fs.readFile(endpointPath, 'utf8'))
  if (
    endpoint?.version !== 1 ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1
  ) {
    throw new LocalServiceError(
      'INVALID_ENDPOINT',
      'Markover service metadata is invalid.'
    )
  }
  return endpoint
}

async function requestJson(endpointPath, method, requestPath, body = null) {
  const endpoint = await readEndpoint(endpointPath)
  const contents = body === null ? null : JSON.stringify(body)

  return new Promise((resolve, reject) => {
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
    }, (response) => {
      response.setEncoding('utf8')
      let responseBody = ''
      response.on('data', (chunk) => {
        responseBody += chunk
      })
      response.on('end', () => {
        let parsed
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

        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new LocalServiceError(
            parsed.error?.code || 'REQUEST_FAILED',
            parsed.error?.message || `Markover returned ${response.statusCode}.`,
            response.statusCode
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

module.exports = {
  LocalServiceError,
  readEndpoint,
  requestJson
}
