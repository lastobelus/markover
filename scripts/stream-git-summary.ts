import { spawn } from 'node:child_process'
import crypto from 'node:crypto'

const repository = process.argv[2]
const serializedArgs = process.argv[3]
if (repository === undefined || serializedArgs === undefined) {
  process.stderr.write('stream-git-summary requires a repository and Git arguments.\n')
  process.exitCode = 1
} else {
  let parsed: unknown
  try {
    parsed = JSON.parse(serializedArgs) as unknown
  } catch {
    parsed = null
  }
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
    process.stderr.write('stream-git-summary received invalid Git arguments.\n')
    process.exitCode = 1
  } else {
    const child = spawn('git', parsed, {
      cwd: repository,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const digest = crypto.createHash('sha256')
    const stderr: Buffer[] = []
    let stderrBytes = 0
    let bytes = 0
    let settled = false
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      digest.update(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = Math.max(0, 64 * 1024 - stderrBytes)
      if (remaining === 0) return
      const retained = chunk.subarray(0, remaining)
      stderr.push(retained)
      stderrBytes += retained.byteLength
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (code !== 0) {
        process.stderr.write(
          `${Buffer.concat(stderr).toString('utf8').trim() || `git exited ${String(code)}`}\n`
        )
        process.exitCode = 1
        return
      }
      process.stdout.write(`${JSON.stringify({
        bytes,
        sha256: digest.digest('hex')
      })}\n`)
    })
  }
}
