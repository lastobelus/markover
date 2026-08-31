/* global module, process, require */

const { Buffer } = require('node:buffer')

const ACTION_PROTOCOL_VERSION = 1
const ACTION_PROTOCOL_OSC = '777;T3ActionEvent'
const ACTION_RUN_ID_ENV = 'T3CODE_ACTION_RUN_ID'
const ACTION_EVENT_TOKEN_ENV = 'T3CODE_ACTION_EVENT_TOKEN'
const ACTION_EVENT_MAX_JSON_CHARACTERS = 10_000
const ACTION_EVENT_MAX_ENCODED_CHARACTERS = 16_384

function frame(runId, token, event) {
  const json = JSON.stringify(event)
  if (json.length > ACTION_EVENT_MAX_JSON_CHARACTERS) {
    throw new Error('Action protocol event exceeds the JSON transport limit.')
  }
  const payload = Buffer.from(json, 'utf8').toString('base64url')
  if (payload.length > ACTION_EVENT_MAX_ENCODED_CHARACTERS) {
    throw new Error('Action protocol event exceeds the encoded transport limit.')
  }
  return `\u001b]${ACTION_PROTOCOL_OSC};${runId};${token};${payload}\u0007`
}

function createMarkoverActionReporter({
  label,
  env = process.env,
  stdout = (data) => process.stdout.write(data),
  stderr = (data) => process.stderr.write(data)
}) {
  const runId = env[ACTION_RUN_ID_ENV]
  const token = env[ACTION_EVENT_TOKEN_ENV]
  const resumable = Boolean(runId && token)
  let terminal = false

  const emit = (event) => {
    stdout(frame(String(runId), String(token), event))
  }

  return {
    resumable,
    progress(progress) {
      if (terminal) throw new Error('Cannot report Action progress after its terminal result.')
      if (resumable) {
        emit({
          kind: 'progress',
          progress: { version: ACTION_PROTOCOL_VERSION, ...progress }
        })
        return
      }
      const state = progress.state === 'working' ? 'Working' : 'Waiting'
      stdout(`[${label}] ${state}: ${progress.summary}\n`)
    },
    terminal({ fallback, report, stream = 'stdout' }) {
      if (terminal) throw new Error('Action already reported its terminal result.')
      terminal = true
      if (resumable && report) {
        emit({
          kind: 'result',
          report: { version: ACTION_PROTOCOL_VERSION, ...report }
        })
        return
      }
      ;(stream === 'stderr' ? stderr : stdout)(`${fallback}\n`)
    }
  }
}

module.exports = {
  ACTION_EVENT_TOKEN_ENV,
  ACTION_PROTOCOL_OSC,
  ACTION_PROTOCOL_VERSION,
  ACTION_RUN_ID_ENV,
  createMarkoverActionReporter,
  frame
}
