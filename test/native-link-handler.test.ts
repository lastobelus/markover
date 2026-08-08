import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const sourcePath = path.join(root, 'native/MarkoverLinkHandler.swift')
const source = fs.readFileSync(sourcePath, 'utf8')

const testMacos = process.platform === 'darwin' ? test : test.skip

testMacos('native handler typechecks and remains forwarding-only', () => {
  const result = spawnSync('/usr/bin/swiftc', [
    '-typecheck',
    '-framework', 'AppKit',
    '-framework', 'CoreServices',
    sourcePath
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(source, /Process\(|NSWorkspace\.shared\.openApplication/)
  assert.doesNotMatch(source, /\bgit\b|\bnpm\b|swiftc|codesign/i)
})

test('native forwarding proves identity before sending the capability', () => {
  const health = source.indexOf('healthUrl,')
  const activation = source.indexOf('activationUrl,')
  assert.ok(health >= 0 && health < activation)
  assert.match(source, /health\.instanceId == endpoint\.instanceId/)
  assert.match(source, /forHTTPHeaderField: "Authorization"/)
  assert.match(source, /credential\.instanceId == endpoint\.instanceId/)
  assert.match(
    source,
    /activationUrl,[\s\S]*token: credential\.token,[\s\S]*timeoutInterval: 12/
  )
})

test('native errors are bounded, redacted, instance-specific, and one-button', () => {
  assert.match(source, /diagnostics = Array\(diagnostics\.suffix\(50\)\)/)
  assert.match(source, /title: "\\\(instanceName\) isn’t running"/)
  assert.match(source, /alert\.addButton\(withTitle: "OK"\)/)
  const diagnostic = source.slice(
    source.indexOf('private struct Diagnostic'),
    source.indexOf('private struct HandlerFailure')
  )
  assert.doesNotMatch(diagnostic, /token|authorization|reviewId|content/i)
})

test('native handler queues delivered URLs before terminating', () => {
  assert.match(source, /private var pendingValues: \[String\?\] = \[\]/)
  assert.match(source, /pendingValues\.append\(value\)/)
  assert.match(source, /let value = pendingValues\.removeFirst\(\)/)
  assert.match(source, /if pendingValues\.isEmpty \{\s*NSApp\.terminate/)
  assert.doesNotMatch(source, /guard !handled else/)
})
