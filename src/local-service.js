const http = require('node:http')

const MAXIMUM_BODY_BYTES = 16 * 1024 * 1024

function sendJson(response, statusCode, body) {
  const contents = `${JSON.stringify(body)}\n`
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(contents)
  })
  response.end(contents)
}

async function readJson(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAXIMUM_BODY_BYTES) {
      const error = new Error('Request body is too large.')
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }

  if (!chunks.length) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.code = 'INVALID_JSON'
    throw error
  }
}

function errorStatus(error) {
  if (error.code === 'NOT_FOUND') return 404
  if (
    error.code === 'INVALID_ID' ||
    error.code === 'INVALID_IMPORT' ||
    error.code === 'INVALID_JSON' ||
    error.code === 'INVALID_REVIEW' ||
    error.code === 'REVIEW_MISMATCH'
  ) {
    return 400
  }
  if (error.code === 'NOT_EDITABLE') return 409
  if (error.code === 'BODY_TOO_LARGE') return 413
  return 500
}

function reviewRoute(pathname) {
  const match = /^\/reviews\/([^/]+)(?:\/(handoff|edit))?$/.exec(pathname)
  if (!match) return null
  return {
    reviewId: decodeURIComponent(match[1]),
    action: match[2] || null
  }
}

async function startLocalService({
  store,
  beforeAction = async () => {},
  importReviews = async () => [],
  onChange = () => {}
}) {
  const actionQueues = new Map()
  function serializeReviewAction(reviewId, operation) {
    const previous = actionQueues.get(reviewId) || Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    actionQueues.set(reviewId, current)
    return current.finally(() => {
      if (actionQueues.get(reviewId) === current) {
        actionQueues.delete(reviewId)
      }
    })
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok', version: 1 })
        return
      }

      if (request.method === 'GET' && url.pathname === '/reviews') {
        sendJson(response, 200, { reviews: await store.list() })
        return
      }

      if (request.method === 'POST' && url.pathname === '/reviews/import') {
        const body = await readJson(request)
        if (typeof body?.sourceDirectory !== 'string' || !body.sourceDirectory) {
          const error = new Error('A review import source directory is required.')
          error.code = 'INVALID_IMPORT'
          throw error
        }
        const reviewIds = await importReviews(body.sourceDirectory)
        for (const reviewId of reviewIds) {
          await onChange(await store.load(reviewId), 'imported')
        }
        sendJson(response, 200, { imported: reviewIds })
        return
      }

      if (request.method === 'POST' && url.pathname === '/reviews') {
        const body = await readJson(request)
        const artifact = await store.create({
          tree: body?.tree,
          ...(body?.metadata || {})
        })
        await onChange(artifact, 'created')
        sendJson(response, 201, {
          reviewId: artifact.review.id,
          status: artifact.review.status
        })
        return
      }

      const route = reviewRoute(url.pathname)
      if (route && request.method === 'GET' && !route.action) {
        sendJson(response, 200, await store.load(route.reviewId))
        return
      }

      if (
        route &&
        request.method === 'POST' &&
        (route.action === 'handoff' || route.action === 'edit')
      ) {
        const artifact = await serializeReviewAction(route.reviewId, async () => {
          let rollbackHandoff = null
          if (route.action === 'handoff') {
            const current = await store.load(route.reviewId)
            if (current.review.status === 'editing') {
              rollbackHandoff = await beforeAction(route.reviewId, route.action)
            }
          }
          let changed
          try {
            changed = route.action === 'handoff'
              ? await store.handoff(route.reviewId)
              : await store.edit(route.reviewId)
          } catch (error) {
            await rollbackHandoff?.()
            throw error
          }
          await onChange(changed, route.action)
          return changed
        })
        sendJson(
          response,
          200,
          route.action === 'handoff'
            ? artifact
            : {
                reviewId: artifact.review.id,
                status: artifact.review.status
              }
        )
        return
      }

      sendJson(response, 404, {
        error: { code: 'NOT_FOUND', message: 'Route not found.' }
      })
    } catch (error) {
      sendJson(response, errorStatus(error), {
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message
        }
      })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

module.exports = {
  MAXIMUM_BODY_BYTES,
  readJson,
  reviewRoute,
  startLocalService
}
