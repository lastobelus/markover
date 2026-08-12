import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  type CommandResult,
  type DecisionGardenerHostConfig,
  decisionGardenerAuditTimeoutMilliseconds,
  decisionGardenerHeartbeatSeconds,
  decisionGardenerHostLabel,
  decisionGardenerNotifierTimeoutMilliseconds,
  decisionGardenerHostStatus,
  decisionGardenerLaunchAgentPath,
  installDecisionGardenerLaunchAgent,
  parseDecisionGardenerHostCli,
  parseDecisionGardenerHostConfig,
  runDecisionGardenerAuditProcess,
  runDecisionGardenerHostCycle,
  runHostNotificationCommand,
  sendDecisionGardenerNotification,
  testDecisionGardenerNotifier,
  uninstallDecisionGardenerLaunchAgent
} from '../scripts/decision-gardener-host'

function config(root: string): DecisionGardenerHostConfig {
  return {
    auditIntervalMinutes: 60,
    codex: path.join(root, 'bin', 'codex'),
    environmentPath: [path.join(root, 'bin'), '/usr/bin', '/bin'],
    model: 'gpt-5.6-sol',
    notifier: { command: ['/usr/bin/notify-test'], kind: 'command' },
    reasoningEffort: 'high',
    repository: path.join(root, 'repository'),
    runStore: path.join(root, 'run-store'),
    schemaVersion: 1
  }
}

async function fixture(): Promise<{
  config: DecisionGardenerHostConfig
  configPath: string
  root: string
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markover-gardener-host-'))
  const value = config(root)
  await fs.mkdir(path.join(root, 'bin'))
  await fs.mkdir(value.repository)
  await fs.mkdir(value.runStore)
  await fs.writeFile(value.codex, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const configPath = path.join(value.runStore, 'host-config.json')
  await fs.writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  return { config: value, configPath, root }
}

function cleanAudit(runStore: string) {
  return {
    runDirectory: path.join(runStore, 'runs', 'test'),
    status: 'no_changes' as const,
    target: 'a'.repeat(40)
  }
}

test('host config is strict, absolute, and shell-free', () => {
  const parsed = parseDecisionGardenerHostConfig(config('/tmp/gardener'))
  assert.equal(parsed.auditIntervalMinutes, 60)
  assert.deepEqual(parsed.notifier, {
    command: ['/usr/bin/notify-test'],
    kind: 'command'
  })
  assert.throws(() => parseDecisionGardenerHostConfig({
    ...config('/tmp/gardener'),
    auditIntervalMinutes: 4
  }), /at least five minutes/)
  assert.throws(() => parseDecisionGardenerHostConfig({
    ...config('/tmp/gardener'),
    notifier: { command: 'notify | mail', kind: 'command' }
  }), /non-empty string array/)
  assert.throws(() => parseDecisionGardenerHostConfig({
    ...config('/tmp/gardener'),
    unexpected: true
  }), /unknown fields/)
  assert.deepEqual(parseDecisionGardenerHostCli([
    'heartbeat', '--config', '/tmp/gardener/config.json'
  ]), {
    command: 'heartbeat',
    configPath: '/tmp/gardener/config.json'
  })
})

test('heartbeat reloads cadence and writes a record even when no audit is due', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  let current = new Date('2026-08-11T00:00:00.000Z')
  let audits = 0
  const dependencies = {
    now: () => new Date(current),
    runAudit: () => {
      audits += 1
      assert.equal(process.env.PATH, host.config.environmentPath.join(path.delimiter))
      return Promise.resolve(cleanAudit(host.config.runStore))
    },
    runCommand: (): CommandResult => ({ status: 0, stderr: '', stdout: '' })
  }
  const first = await runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies)
  assert.equal(first.status, 'completed')
  current = new Date('2026-08-11T00:30:00.000Z')
  const skipped = await runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies)
  assert.equal(skipped.status, 'not_due')
  assert.equal(audits, 1)

  const faster = { ...host.config, auditIntervalMinutes: 15 }
  await fs.writeFile(host.configPath, `${JSON.stringify(faster, null, 2)}\n`)
  const reloaded = await runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies)
  assert.equal(reloaded.status, 'completed')
  assert.equal(audits, 2)
  assert.equal((await fs.readdir(path.join(host.config.runStore, 'host-runs'))).length, 3)
  const log = await fs.readFile(path.join(host.config.runStore, 'host.log'), 'utf8')
  assert.match(log, /"status":"not_due"/)
  assert.match(log, /"status":"completed"/)
})

test('an unwritable host log transitions health and notifies with a terminal record', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  await fs.mkdir(path.join(host.config.runStore, 'host.log'))
  const events: string[] = []
  let audited = false
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runAudit: () => {
      audited = true
      return Promise.resolve(cleanAudit(host.config.runStore))
    },
    runCommand: (_executable, _args, options) => {
      events.push(options?.env?.MARKOVER_DECISION_GARDENER_EVENT ?? 'missing')
      return { status: 0, stderr: '', stdout: '' }
    }
  }), /Could not append the decision-gardener host log/)
  assert.equal(audited, false)
  assert.deepEqual(events, ['failed'])
  const records = await fs.readdir(path.join(host.config.runStore, 'host-runs'))
  assert.equal(records.length, 1)
  const attempt = JSON.parse(await fs.readFile(
    path.join(host.config.runStore, 'host-runs', records[0] ?? ''),
    'utf8'
  )) as { error: string; status: string }
  assert.equal(attempt.status, 'failed')
  assert.match(attempt.error, /Could not append the decision-gardener host log/)
  const state = JSON.parse(await fs.readFile(
    path.join(host.config.runStore, 'host-state.json'),
    'utf8'
  )) as { health: string; lastNotifiedHealth: string }
  assert.equal(state.health, 'failed')
  assert.equal(state.lastNotifiedHealth, 'failed')
})

test('an unwritable host log does not mutate health while another audit owns the lock', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  await fs.mkdir(path.join(host.config.runStore, 'host.log'))
  let notified = false
  const outcome = await runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    acquireLock: () => Promise.reject(new Error(
      `A decision-gardener run already owns ${path.join(host.config.runStore, 'host.lock')}: owner`
    )),
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runCommand: () => {
      notified = true
      return { status: 0, stderr: '', stdout: '' }
    }
  })
  assert.equal(outcome.status, 'busy')
  assert.equal(notified, false)
  await assert.rejects(fs.stat(path.join(host.config.runStore, 'host-state.json')), /ENOENT/)
  const attempt = JSON.parse(await fs.readFile(outcome.record, 'utf8')) as { status: string }
  assert.equal(attempt.status, 'busy')
})

test('failed heartbeats retry every interval tick and notify only health transitions', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  let current = new Date('2026-08-11T00:00:00.000Z')
  let attempt = 0
  const events: string[] = []
  const dependencies = {
    now: () => new Date(current),
    runAudit: () => {
      attempt += 1
      if (attempt < 4) return Promise.reject(new Error('network unavailable'))
      return Promise.resolve(cleanAudit(host.config.runStore))
    },
    runCommand: (
      _executable: string,
      _args: readonly string[],
      options?: { env?: NodeJS.ProcessEnv }
    ): CommandResult => {
      events.push(options?.env?.MARKOVER_DECISION_GARDENER_EVENT ?? 'missing')
      if (events.length === 1) {
        return { status: 1, stderr: 'notification transport unavailable', stdout: '' }
      }
      return { status: 0, stderr: '', stdout: '' }
    }
  }
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies), /network unavailable/)
  current = new Date('2026-08-11T00:05:00.000Z')
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies), /network unavailable/)
  assert.deepEqual(events, ['failed', 'failed', 'failed'])
  current = new Date('2026-08-11T00:10:00.000Z')
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies), /network unavailable/)
  assert.deepEqual(events, ['failed', 'failed', 'failed'])
  current = new Date('2026-08-11T00:15:00.000Z')
  const recovered = await runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies)
  assert.equal(recovered.status, 'completed')
  assert.deepEqual(events, ['failed', 'failed', 'failed', 'recovered'])
  const state = JSON.parse(
    await fs.readFile(path.join(host.config.runStore, 'host-state.json'), 'utf8')
  ) as { health: string; lastNotifiedHealth: string }
  assert.deepEqual(state, {
    ...state,
    health: 'healthy',
    lastNotifiedHealth: 'healthy'
  })
})

test('notifier commands have a finite timeout and surface expiration as failure', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  let cwd: string | undefined
  let timeout: number | undefined
  await assert.rejects(sendDecisionGardenerNotification({
    config: host.config,
    event: 'test',
    record: host.configPath,
    runCommand: (_executable, _args, options) => {
      cwd = options?.cwd
      timeout = options?.timeout
      throw new Error('operation timed out')
    },
    summary: 'timeout test'
  }), /notifier failed: operation timed out/)
  assert.equal(cwd, host.config.runStore)
  assert.equal(timeout, decisionGardenerNotifierTimeoutMilliseconds)
})

test('standalone notifier preflight creates and secures its custom run store', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const freshRunStore = path.join(host.root, 'standalone-run-store')
  const custom = { ...host.config, runStore: freshRunStore }
  await testDecisionGardenerNotifier(custom, host.configPath, (
    _executable,
    _args,
    options
  ) => {
    assert.equal(options?.cwd, freshRunStore)
    assert.equal(statSync(freshRunStore).mode & 0o077, 0)
    return { status: 0, stderr: '', stdout: '' }
  })
  assert.equal(statSync(freshRunStore).mode & 0o077, 0)
})

test('the production notifier runner force-kills a command that ignores termination', async () => {
  const started = Date.now()
  await assert.rejects(runHostNotificationCommand('/bin/sh', [
    '-c', 'trap "" TERM; while :; do sleep 1; done'
  ], { timeout: 50 }), /timed out after 50 ms/)
  assert.ok(Date.now() - started < 2_000)
})

test('the production audit runner force-kills a process tree at its deadline', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const scriptPath = path.join(host.root, 'hanging-audit.js')
  await fs.writeFile(scriptPath, [
    "process.on('SIGTERM', () => undefined)",
    'setInterval(() => undefined, 1_000)',
    ''
  ].join('\n'))
  const started = Date.now()
  await assert.rejects(runDecisionGardenerAuditProcess(
    host.config,
    host.configPath,
    { scriptPath, timeout: 50 }
  ), /Decision-gardener audit timed out after 50 ms/)
  assert.ok(Date.now() - started < 2_000)
  assert.equal(decisionGardenerAuditTimeoutMilliseconds, 6 * 60 * 60 * 1000)
})

test('a failure record is finalized before the notifier reads it', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const notifiedRecords: Array<{ error?: string; status?: string }> = []
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runAudit: () => Promise.reject(new Error('audit transport failed')),
    runCommand: (_executable, _args, options) => {
      const recordPath = options?.env?.MARKOVER_DECISION_GARDENER_RECORD
      assert.ok(recordPath)
      notifiedRecords.push(JSON.parse(readFileSync(recordPath, 'utf8')) as {
        error?: string
        status?: string
      })
      return { status: 0, stderr: '', stdout: '' }
    }
  }), /audit transport failed/)
  assert.deepEqual(notifiedRecords[0], {
    ...notifiedRecords[0],
    error: 'audit transport failed',
    status: 'failed'
  })
})

test('a pending failure notification is delivered before recovery', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  let current = new Date('2026-08-11T00:00:00.000Z')
  let attempt = 0
  const events: Array<{ event: string; record: string }> = []
  const dependencies = {
    now: () => new Date(current),
    runAudit: () => {
      attempt += 1
      if (attempt === 1) return Promise.reject(new Error('initial audit failure'))
      return Promise.resolve(cleanAudit(host.config.runStore))
    },
    runCommand: (
      _executable: string,
      _args: readonly string[],
      options?: { env?: NodeJS.ProcessEnv }
    ): CommandResult => {
      events.push({
        event: options?.env?.MARKOVER_DECISION_GARDENER_EVENT ?? 'missing',
        record: options?.env?.MARKOVER_DECISION_GARDENER_RECORD ?? 'missing'
      })
      if (events.length === 1) {
        return { status: 1, stderr: 'notification transport unavailable', stdout: '' }
      }
      return { status: 0, stderr: '', stdout: '' }
    }
  }
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies), /initial audit failure/)
  current = new Date('2026-08-11T00:05:00.000Z')
  const recovered = await runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, dependencies)
  assert.equal(recovered.status, 'completed')
  assert.deepEqual(events.map(({ event }) => event), ['failed', 'failed', 'recovered'])
  assert.equal(events[1]?.record, events[0]?.record)
  assert.notEqual(events[2]?.record, events[0]?.record)
  const state = JSON.parse(await fs.readFile(
    path.join(host.config.runStore, 'host-state.json'),
    'utf8'
  )) as { health: string; pendingFailureRecords: string[] }
  assert.equal(state.health, 'healthy')
  assert.deepEqual(state.pendingFailureRecords, [])
})

test('a lock failure retries an older pending failure record first', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const events: Array<{ event: string; record: string }> = []
  const runCommand = (
    _executable: string,
    _args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv }
  ): CommandResult => {
    events.push({
      event: options?.env?.MARKOVER_DECISION_GARDENER_EVENT ?? 'missing',
      record: options?.env?.MARKOVER_DECISION_GARDENER_RECORD ?? 'missing'
    })
    if (events.length === 1) {
      return { status: 1, stderr: 'notification transport unavailable', stdout: '' }
    }
    return { status: 0, stderr: '', stdout: '' }
  }
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runAudit: () => Promise.reject(new Error('initial audit failure')),
    runCommand
  }), /initial audit failure/)
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    acquireLock: () => Promise.reject(new Error('The lock owner record is not valid JSON.')),
    now: () => new Date('2026-08-11T00:05:00.000Z'),
    runCommand
  }), /Could not acquire the decision-gardener host lock/)
  assert.deepEqual(events.map(({ event }) => event), ['failed', 'failed', 'failed'])
  assert.equal(events[1]?.record, events[0]?.record)
  assert.notEqual(events[2]?.record, events[0]?.record)
  const state = JSON.parse(await fs.readFile(
    path.join(host.config.runStore, 'host-state.json'),
    'utf8'
  )) as { lastNotifiedHealth: string; pendingFailureRecords: string[] }
  assert.equal(state.lastNotifiedHealth, 'failed')
  assert.deepEqual(state.pendingFailureRecords, [])
})

test('a current lock failure remains pending after its older alert is delivered', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const events: Array<{ event: string; record: string }> = []
  const runCommand = (
    _executable: string,
    _args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv }
  ): CommandResult => {
    events.push({
      event: options?.env?.MARKOVER_DECISION_GARDENER_EVENT ?? 'missing',
      record: options?.env?.MARKOVER_DECISION_GARDENER_RECORD ?? 'missing'
    })
    if (events.length === 1 || events.length === 3) {
      return { status: 1, stderr: 'notification transport unavailable', stdout: '' }
    }
    return { status: 0, stderr: '', stdout: '' }
  }
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runAudit: () => Promise.reject(new Error('initial audit failure')),
    runCommand
  }), /initial audit failure/)
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    acquireLock: () => Promise.reject(new Error('The lock owner record is not valid JSON.')),
    now: () => new Date('2026-08-11T00:05:00.000Z'),
    runCommand
  }), /Notifier error/)
  assert.equal(events[1]?.record, events[0]?.record)
  assert.notEqual(events[2]?.record, events[0]?.record)
  const pendingState = JSON.parse(await fs.readFile(
    path.join(host.config.runStore, 'host-state.json'),
    'utf8'
  )) as { lastNotifiedHealth: string; pendingFailureRecords: string[] }
  assert.equal(pendingState.lastNotifiedHealth, 'failed')
  assert.deepEqual(pendingState.pendingFailureRecords, [events[2]?.record])

  await runDecisionGardenerHostCycle({ configPath: host.configPath }, {
    now: () => new Date('2026-08-11T00:10:00.000Z'),
    runAudit: () => Promise.resolve(cleanAudit(host.config.runStore)),
    runCommand
  })
  assert.deepEqual(events.slice(3).map(({ event }) => event), ['failed', 'recovered'])
  assert.equal(events[3]?.record, events[2]?.record)
})

test('a newer lock failure queues behind an older alert while delivery remains down', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const events: Array<{ event: string; record: string }> = []
  const runCommand = (
    _executable: string,
    _args: readonly string[],
    options?: { env?: NodeJS.ProcessEnv }
  ): CommandResult => {
    events.push({
      event: options?.env?.MARKOVER_DECISION_GARDENER_EVENT ?? 'missing',
      record: options?.env?.MARKOVER_DECISION_GARDENER_RECORD ?? 'missing'
    })
    return events.length <= 2
      ? { status: 1, stderr: 'notification transport unavailable', stdout: '' }
      : { status: 0, stderr: '', stdout: '' }
  }
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runAudit: () => Promise.reject(new Error('initial audit failure')),
    runCommand
  }), /initial audit failure/)
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    acquireLock: () => Promise.reject(new Error('The lock owner record is not valid JSON.')),
    now: () => new Date('2026-08-11T00:05:00.000Z'),
    runCommand
  }), /Notifier error/)
  const queuedState = JSON.parse(await fs.readFile(
    path.join(host.config.runStore, 'host-state.json'),
    'utf8'
  )) as { pendingFailureRecords: string[] }
  assert.equal(queuedState.pendingFailureRecords[0], events[0]?.record)
  assert.notEqual(queuedState.pendingFailureRecords[1], events[0]?.record)

  await runDecisionGardenerHostCycle({ configPath: host.configPath }, {
    now: () => new Date('2026-08-11T00:10:00.000Z'),
    runAudit: () => Promise.resolve(cleanAudit(host.config.runStore)),
    runCommand
  })
  assert.deepEqual(events.slice(2).map(({ event }) => event), [
    'failed', 'failed', 'recovered'
  ])
  assert.equal(events[2]?.record, events[0]?.record)
  assert.equal(events[3]?.record, queuedState.pendingFailureRecords[1])
})

test('an unreadable host state notifies failure and preserves the invalid evidence', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const statePath = path.join(host.config.runStore, 'host-state.json')
  await fs.writeFile(statePath, '{ invalid json\n', { mode: 0o600 })
  const events: string[] = []
  let audited = false
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runAudit: () => {
      audited = true
      return Promise.resolve(cleanAudit(host.config.runStore))
    },
    runCommand: (_executable, _args, options) => {
      events.push(options?.env?.MARKOVER_DECISION_GARDENER_EVENT ?? 'missing')
      return { status: 0, stderr: '', stdout: '' }
    }
  }), /Could not read decision-gardener host state/)
  assert.equal(audited, false)
  assert.deepEqual(events, ['failed'])
  const entries = await fs.readdir(host.config.runStore)
  const evidence = entries.find((entry) => entry.startsWith('host-state.invalid.'))
  assert.ok(evidence)
  assert.equal(
    await fs.readFile(path.join(host.config.runStore, evidence), 'utf8'),
    '{ invalid json\n'
  )
  const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
    health: string
    lastNotifiedHealth: string
  }
  assert.equal(state.health, 'failed')
  assert.equal(state.lastNotifiedHealth, 'failed')
})

test('a concurrent wakeup records busy without disturbing health or running Codex', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const lockPath = path.join(host.config.runStore, 'host.lock')
  let audited = false
  const outcome = await runDecisionGardenerHostCycle({
    configPath: host.configPath,
    force: true,
    trigger: 'run-now'
  }, {
    acquireLock: () => Promise.reject(new Error(
      `A decision-gardener run already owns ${lockPath}: {"pid":123}`
    )),
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runAudit: () => {
      audited = true
      return Promise.resolve(cleanAudit(host.config.runStore))
    }
  })
  assert.equal(outcome.status, 'busy')
  assert.equal(audited, false)
  await assert.rejects(
    fs.stat(path.join(host.config.runStore, 'host-state.json')),
    /ENOENT/
  )
  const record = JSON.parse(await fs.readFile(outcome.record, 'utf8')) as { status: string }
  assert.equal(record.status, 'busy')
})

test('a non-contention host-lock failure transitions health and notifies', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const events: string[] = []
  let audited = false
  await assert.rejects(runDecisionGardenerHostCycle({
    configPath: host.configPath
  }, {
    acquireLock: () => Promise.reject(new Error('The lock owner record is not valid JSON.')),
    now: () => new Date('2026-08-11T00:00:00.000Z'),
    runAudit: () => {
      audited = true
      return Promise.resolve(cleanAudit(host.config.runStore))
    },
    runCommand: (_executable, _args, options) => {
      events.push(options?.env?.MARKOVER_DECISION_GARDENER_EVENT ?? 'missing')
      return { status: 0, stderr: '', stdout: '' }
    }
  }), /Could not acquire the decision-gardener host lock.*not valid JSON/)
  assert.equal(audited, false)
  assert.deepEqual(events, ['failed'])
  const state = JSON.parse(await fs.readFile(
    path.join(host.config.runStore, 'host-state.json'),
    'utf8'
  )) as { health: string; lastError: string; lastNotifiedHealth: string }
  assert.equal(state.health, 'failed')
  assert.match(state.lastError, /lock owner record is not valid JSON/)
  assert.equal(state.lastNotifiedHealth, 'failed')
})

test('install fails closed on notifier test and loads one fixed heartbeat plist', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const homeDirectory = path.join(host.root, 'home')
  const plistPath = decisionGardenerLaunchAgentPath(homeDirectory)
  const nodeExecutable = path.join(host.root, 'bin', 'node')
  const scriptPath = path.join(host.root, 'bin', 'decision-gardener-host.js')
  await fs.writeFile(nodeExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  await fs.writeFile(scriptPath, 'void 0\n', { mode: 0o600 })
  const failedCalls: string[][] = []
  await assert.rejects(installDecisionGardenerLaunchAgent(host.configPath, {
    homeDirectory,
    nodeExecutable,
    platform: 'darwin',
    runCommand: (executable, args) => {
      failedCalls.push([executable, ...args])
      return { status: 1, stderr: 'notifier unavailable', stdout: '' }
    },
    scriptPath,
    uid: 501
  }), /notifier failed/)
  await assert.rejects(fs.stat(plistPath), /ENOENT/)
  assert.equal(failedCalls.some((call) => call[0] === '/bin/launchctl'), false)

  const calls: string[][] = []
  const installed = await installDecisionGardenerLaunchAgent(host.configPath, {
    homeDirectory,
    nodeExecutable,
    platform: 'darwin',
    runCommand: (executable, args) => {
      calls.push([executable, ...args])
      if (executable === '/bin/launchctl' && args[0] === 'print') {
        return { status: 1, stderr: 'not found', stdout: '' }
      }
      return { status: 0, stderr: '', stdout: '' }
    },
    uid: 501
  })
  assert.equal(installed.status, 'installed')
  const plist = await fs.readFile(plistPath, 'utf8')
  assert.match(plist, new RegExp(`<integer>${String(decisionGardenerHeartbeatSeconds)}</integer>`))
  assert.match(plist, /<key>RunAtLoad<\/key>/)
  assert.match(plist, /<string>Background<\/string>/)
  assert.match(plist, /decision-gardener-host\.js/)
  assert.match(plist, /host-config\.json/)
  const installedScriptPath = plist.match(
    /<string>([^<]*run-store\/controller\/[0-9a-f]{64}\/build\/scripts\/decision-gardener-host\.js)<\/string>/
  )?.[1]
  assert.ok(installedScriptPath)
  assert.equal((await fs.readdir(path.join(host.config.runStore, 'controller'))).length, 1)
  const installedProjectRoot = path.resolve(path.dirname(installedScriptPath), '../..')
  assert.equal(
    await fs.readFile(path.join(installedProjectRoot, '.ai/prompts/decision-gardener.md'), 'utf8'),
    readFileSync(path.join(process.cwd(), '.ai/prompts/decision-gardener.md'), 'utf8')
  )
  assert.equal(
    await fs.readFile(path.join(path.dirname(installedScriptPath), 'stream-git-summary.js'), 'utf8'),
    readFileSync(path.join(process.cwd(), 'build/scripts/stream-git-summary.js'), 'utf8')
  )
  assert.match(plist, new RegExp(
    `<key>WorkingDirectory<\\/key>\\s*<string>${host.config.runStore}<\\/string>`
  ))
  assert.doesNotMatch(plist, new RegExp(
    `<key>WorkingDirectory<\\/key>\\s*<string>${host.config.repository}<\\/string>`
  ))
  assert.deepEqual(calls.find((call) => call.includes('bootstrap')), [
    '/bin/launchctl', 'bootstrap', 'gui/501', plistPath
  ])
  const status = await decisionGardenerHostStatus(host.configPath, {
    homeDirectory,
    platform: 'darwin',
    runCommand: () => ({ status: 0, stderr: '', stdout: '' }),
    uid: 501
  })
  assert.equal(status.loaded, true)
  const removed = await uninstallDecisionGardenerLaunchAgent(host.configPath, {
    homeDirectory,
    platform: 'darwin',
    runCommand: () => ({ status: 0, stderr: '', stdout: '' }),
    uid: 501
  })
  assert.equal(removed.status, 'uninstalled')
  await assert.rejects(fs.stat(plistPath), /ENOENT/)
  assert.equal((await fs.stat(host.configPath)).isFile(), true)
  assert.equal(decisionGardenerHostLabel, 'com.lastobelus.markover.decision-gardener')
})

test('uninstall refuses to unload the launch agent while an audit owns the host lock', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const launchctlCalls: string[][] = []
  await assert.rejects(uninstallDecisionGardenerLaunchAgent(host.configPath, {
    acquireLock: () => Promise.reject(new Error('An active audit owns host.lock.')),
    homeDirectory: path.join(host.root, 'home'),
    platform: 'darwin',
    runCommand: (executable, args) => {
      if (executable === '/bin/launchctl') launchctlCalls.push([executable, ...args])
      return { status: 0, stderr: '', stdout: '' }
    },
    uid: 501
  }), /active audit owns host\.lock/)
  assert.deepEqual(launchctlCalls, [])
})

test('install creates and secures a custom run store before notifier preflight', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const freshRunStore = path.join(host.root, 'fresh-run-store')
  const custom = { ...host.config, runStore: freshRunStore }
  await fs.writeFile(host.configPath, `${JSON.stringify(custom, null, 2)}\n`, { mode: 0o600 })
  const homeDirectory = path.join(host.root, 'home')
  const nodeExecutable = path.join(host.root, 'bin', 'node')
  const scriptPath = path.join(host.root, 'bin', 'decision-gardener-host.js')
  await fs.writeFile(nodeExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  await fs.writeFile(scriptPath, 'void 0\n', { mode: 0o600 })
  await installDecisionGardenerLaunchAgent(host.configPath, {
    homeDirectory,
    nodeExecutable,
    platform: 'darwin',
    runCommand: (executable, args, options) => {
      if (executable !== '/bin/launchctl') {
        assert.equal(options?.cwd, freshRunStore)
        assert.equal(statSync(freshRunStore).mode & 0o077, 0)
      }
      if (executable === '/bin/launchctl' && args[0] === 'print') {
        return { status: 1, stderr: 'not found', stdout: '' }
      }
      return { status: 0, stderr: '', stdout: '' }
    },
    scriptPath,
    uid: 501
  })
  assert.equal(statSync(freshRunStore).mode & 0o077, 0)
})

test('install refuses to unload the launch agent while an audit owns the host lock', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const homeDirectory = path.join(host.root, 'home')
  const nodeExecutable = path.join(host.root, 'bin', 'node')
  const scriptPath = path.join(host.root, 'bin', 'decision-gardener-host.js')
  await fs.writeFile(nodeExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  await fs.writeFile(scriptPath, 'void 0\n', { mode: 0o600 })
  const launchctlCalls: string[][] = []
  await assert.rejects(installDecisionGardenerLaunchAgent(host.configPath, {
    acquireLock: () => Promise.reject(new Error('An active audit owns host.lock.')),
    homeDirectory,
    nodeExecutable,
    platform: 'darwin',
    runCommand: (executable, args) => {
      if (executable === '/bin/launchctl') launchctlCalls.push([executable, ...args])
      return { status: 0, stderr: '', stdout: '' }
    },
    scriptPath,
    uid: 501
  }), /active audit owns host\.lock/)
  assert.deepEqual(launchctlCalls, [])
})

test('a failed reinstall restores and reloads the previous launch agent', async (t) => {
  const host = await fixture()
  t.after(() => fs.rm(host.root, { recursive: true, force: true }))
  const homeDirectory = path.join(host.root, 'home')
  const plistPath = decisionGardenerLaunchAgentPath(homeDirectory)
  const nodeExecutable = path.join(host.root, 'bin', 'node')
  const scriptPath = path.join(host.root, 'bin', 'decision-gardener-host.js')
  await fs.mkdir(path.dirname(plistPath), { recursive: true })
  await fs.writeFile(plistPath, '<plist>previous</plist>\n', { mode: 0o600 })
  await fs.writeFile(nodeExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  await fs.writeFile(scriptPath, 'void 0\n', { mode: 0o600 })
  const launchctlCalls: string[][] = []
  let bootstrap = 0
  await assert.rejects(installDecisionGardenerLaunchAgent(host.configPath, {
    homeDirectory,
    nodeExecutable,
    platform: 'darwin',
    runCommand: (executable, args) => {
      if (executable !== '/bin/launchctl') {
        return { status: 0, stderr: '', stdout: '' }
      }
      launchctlCalls.push([executable, ...args])
      if (args[0] === 'bootstrap') {
        bootstrap += 1
        if (bootstrap === 1) return { status: 1, stderr: 'transient failure', stdout: '' }
      }
      return { status: 0, stderr: '', stdout: '' }
    },
    scriptPath,
    uid: 501
  }), /Could not load the gardener agent: transient failure.*previous installation was restored/)
  assert.equal(await fs.readFile(plistPath, 'utf8'), '<plist>previous</plist>\n')
  assert.deepEqual(launchctlCalls.map((call) => call[1]), [
    'print', 'bootout', 'bootstrap', 'bootstrap'
  ])
})

test('package and runbook expose the complete host lifecycle', async () => {
  const packageSource = await fs.readFile(path.resolve('package.json'), 'utf8')
  const packageContract = JSON.parse(packageSource) as { scripts: Record<string, string> }
  const documentation = await fs.readFile(
    path.resolve('docs/developer/decision-gardener.md'),
    'utf8'
  )
  assert.equal(
    packageContract.scripts['decision-gardener:host'],
    'node build/scripts/decision-gardener-host.js'
  )
  for (const command of [
    'test-notifier', 'install', 'status', 'run-now', 'uninstall'
  ]) assert.match(documentation, new RegExp(`decision-gardener:host -- ${command}`))
  assert.match(documentation, /MARKOVER_DECISION_GARDENER_EVENT/)
  assert.match(documentation, /Every invocation creates a private\s+record/)
  assert.match(documentation, /complete\s+checkpoint-to-tip range/)
})
