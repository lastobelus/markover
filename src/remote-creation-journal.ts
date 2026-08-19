import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const JOURNAL_FORMAT = 'markover-remote-creation'
const JOURNAL_VERSION = 1
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/
const LOCK_RETRY_MILLISECONDS = 10
const LOCK_TIMEOUT_MILLISECONDS = 5_000
const LOCK_TOKEN_PATTERN = /^[a-f0-9]{32}$/

export interface RemoteCreationFingerprintInput {
  profileId: string
  sourcePath: string
  contextSummary: string
  branch?: string | null
  handoffKey?: string | null
  pullRequestNumber?: number | null
  pullRequestUrl?: string | null
  threadId?: string | null
  threadHostKind?: string | null
  threadHostProvider?: string | null
  threadHostThreadId?: string | null
  threadHostMachine?: string | null
}

export interface RemoteCreationReceipt {
  reviewId: string
  reviewUrl: string
  status: string
  requestDigest: string
}

interface StoredRemoteCreationEntry {
  format: typeof JOURNAL_FORMAT
  version: typeof JOURNAL_VERSION
  fingerprint: string
  idempotencyKey: string
  ownerPid: number
  requestDigests: string[]
  state: 'pending' | 'completed'
  receipt?: RemoteCreationReceipt
}

interface StoredRemoteCreationLock {
  ownerPid: number
  token: string
}

export interface RemoteCreationEntry {
  fingerprint: string
  idempotencyKey: string
  ownerPid: number
  requestDigests: string[]
}

export interface RemoteCreationJournalOptions {
  idempotencyKey?: () => string
  processId?: number
  processIsAlive?: (pid: number) => boolean
}

export class RemoteCreationJournalError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RemoteCreationJournalError'
    this.code = code
  }
}

function journalError(code: string, message: string): RemoteCreationJournalError {
  return new RemoteCreationJournalError(code, message)
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : null
}

function sha256(value: string): string {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`
}

function storedEntry(entry: RemoteCreationEntry): StoredRemoteCreationEntry {
  return {
    format: JOURNAL_FORMAT,
    version: JOURNAL_VERSION,
    fingerprint: entry.fingerprint,
    idempotencyKey: entry.idempotencyKey,
    ownerPid: entry.ownerPid,
    requestDigests: [...entry.requestDigests],
    state: 'pending'
  }
}

function decodeEntry(value: unknown, expectedFingerprint: string): StoredRemoteCreationEntry {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.get(value, 'format') !== JOURNAL_FORMAT ||
    Reflect.get(value, 'version') !== JOURNAL_VERSION ||
    Reflect.get(value, 'fingerprint') !== expectedFingerprint ||
    typeof Reflect.get(value, 'idempotencyKey') !== 'string' ||
    !IDEMPOTENCY_KEY_PATTERN.test(Reflect.get(value, 'idempotencyKey') as string) ||
    !Number.isSafeInteger(Reflect.get(value, 'ownerPid')) ||
    (Reflect.get(value, 'ownerPid') as number) < 1 ||
    !Array.isArray(Reflect.get(value, 'requestDigests')) ||
    !(Reflect.get(value, 'requestDigests') as unknown[]).every(
      (digest) => typeof digest === 'string' && DIGEST_PATTERN.test(digest)
    ) ||
    (Reflect.get(value, 'state') !== 'pending' &&
      Reflect.get(value, 'state') !== 'completed')
  ) {
    throw journalError(
      'REMOTE_JOURNAL_INVALID',
      `Remote creation journal entry ${expectedFingerprint} is invalid.`
    )
  }
  const decoded = value as StoredRemoteCreationEntry
  if (decoded.state === 'completed') {
    const receipt = decoded.receipt
    if (
      !receipt ||
      typeof receipt.reviewId !== 'string' ||
      typeof receipt.reviewUrl !== 'string' ||
      typeof receipt.status !== 'string' ||
      !DIGEST_PATTERN.test(receipt.requestDigest)
    ) {
      throw journalError(
        'REMOTE_JOURNAL_INVALID',
        `Completed remote creation journal entry ${expectedFingerprint} has no valid receipt.`
      )
    }
  }
  return decoded
}

function decodeLock(value: unknown): StoredRemoteCreationLock {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isSafeInteger(Reflect.get(value, 'ownerPid')) ||
    (Reflect.get(value, 'ownerPid') as number) < 1 ||
    typeof Reflect.get(value, 'token') !== 'string' ||
    !LOCK_TOKEN_PATTERN.test(Reflect.get(value, 'token') as string)
  ) {
    throw journalError(
      'REMOTE_JOURNAL_INVALID',
      'Remote creation journal lock is invalid.'
    )
  }
  return value as StoredRemoteCreationLock
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds) })
}

async function writeRestricted(
  destination: string,
  entry: StoredRemoteCreationEntry,
  flag: 'wx' | 'w'
): Promise<void> {
  await fs.writeFile(destination, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    flag,
    mode: 0o600
  })
  await fs.chmod(destination, 0o600)
}

export function remoteCreationFingerprint(
  input: RemoteCreationFingerprintInput
): string {
  return sha256(JSON.stringify([
    input.profileId,
    path.resolve(input.sourcePath),
    input.contextSummary,
    input.branch ?? null,
    input.handoffKey ?? null,
    input.pullRequestNumber ?? null,
    input.pullRequestUrl ?? null,
    input.threadId ?? null,
    input.threadHostKind ?? null,
    input.threadHostProvider ?? null,
    input.threadHostThreadId ?? null,
    input.threadHostMachine ?? null
  ]))
}

export class RemoteCreationJournal {
  readonly root: string
  private readonly makeIdempotencyKey: () => string
  private readonly processId: number
  private readonly processIsAlive: (pid: number) => boolean

  constructor(
    root: string,
    {
      idempotencyKey = () => crypto.randomBytes(32).toString('base64url'),
      processId = process.pid,
      processIsAlive = (pid) => {
        try {
          process.kill(pid, 0)
          return true
        } catch (error) {
          return errorCode(error) !== 'ESRCH'
        }
      }
    }:
    RemoteCreationJournalOptions = {}
  ) {
    this.root = path.resolve(root)
    this.makeIdempotencyKey = idempotencyKey
    this.processId = processId
    this.processIsAlive = processIsAlive
  }

  async acquire(
    input: RemoteCreationFingerprintInput
  ): Promise<{
      entry: RemoteCreationEntry
      inProgress: boolean
      resumed: boolean
    }> {
    const fingerprint = remoteCreationFingerprint(input)
    const directory = this.entryDirectory(fingerprint)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    await fs.chmod(this.root, 0o700)
    await fs.chmod(directory, 0o700)
    try {
      const existing = await this.readActive(fingerprint)
      return {
        entry: {
          fingerprint,
          idempotencyKey: existing.idempotencyKey,
          ownerPid: existing.ownerPid,
          requestDigests: [...existing.requestDigests]
        },
        inProgress: existing.requestDigests.length === 0 &&
          this.processIsAlive(existing.ownerPid),
        resumed: true
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
    const idempotencyKey = this.makeIdempotencyKey()
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw journalError(
        'REMOTE_JOURNAL_KEY_INVALID',
        'Remote creation journal generated an invalid idempotency key.'
      )
    }
    const entry: RemoteCreationEntry = {
      fingerprint,
      idempotencyKey,
      ownerPid: this.processId,
      requestDigests: []
    }
    try {
      await writeRestricted(this.activePath(fingerprint), storedEntry(entry), 'wx')
      return { entry, inProgress: false, resumed: false }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const existing = await this.readActive(fingerprint)
      return {
        entry: {
          fingerprint,
          idempotencyKey: existing.idempotencyKey,
          ownerPid: existing.ownerPid,
          requestDigests: [...existing.requestDigests]
        },
        inProgress: existing.requestDigests.length === 0 &&
          this.processIsAlive(existing.ownerPid),
        resumed: true
      }
    }
  }

  async appendRequestDigest(
    entry: RemoteCreationEntry,
    requestDigest: string
  ): Promise<RemoteCreationEntry> {
    if (!DIGEST_PATTERN.test(requestDigest)) {
      throw journalError(
        'REMOTE_JOURNAL_DIGEST_INVALID',
        'Remote creation journal requires a SHA-256 request digest.'
      )
    }
    return this.withEntryLock(entry.fingerprint, async () => {
      const current = await this.readMatchingActive(entry)
      if (!current.requestDigests.includes(requestDigest)) {
        current.requestDigests.push(requestDigest)
        await this.replaceActive(current)
      }
      return {
        fingerprint: current.fingerprint,
        idempotencyKey: current.idempotencyKey,
        ownerPid: current.ownerPid,
        requestDigests: [...current.requestDigests]
      }
    })
  }

  async complete(
    entry: RemoteCreationEntry,
    receipt: RemoteCreationReceipt
  ): Promise<void> {
    if (!entry.requestDigests.includes(receipt.requestDigest)) {
      throw journalError(
        'REMOTE_JOURNAL_RECEIPT_INVALID',
        'Remote creation receipt does not match this journal digest history.'
      )
    }
    await this.withEntryLock(entry.fingerprint, async () => {
      let current: StoredRemoteCreationEntry
      try {
        current = await this.readMatchingActive(entry)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
        const completed = await this.readCompleted(entry)
        if (
          completed.receipt?.reviewId === receipt.reviewId &&
          completed.receipt.reviewUrl === receipt.reviewUrl &&
          completed.receipt.status === receipt.status &&
          completed.receipt.requestDigest === receipt.requestDigest
        ) return
        throw journalError(
          'REMOTE_JOURNAL_CONFLICT',
          'Remote creation journal was completed with a different receipt.'
        )
      }
      const completed: StoredRemoteCreationEntry = {
        ...current,
        state: 'completed',
        receipt: { ...receipt }
      }
      await this.replaceActive(completed)
      const completedDirectory = path.join(
        this.entryDirectory(entry.fingerprint),
        'completed'
      )
      await fs.mkdir(completedDirectory, { recursive: true, mode: 0o700 })
      await fs.chmod(completedDirectory, 0o700)
      const destination = this.completedPath(entry)
      try {
        await fs.rename(this.activePath(entry.fingerprint), destination)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
      await fs.chmod(destination, 0o600).catch((error: unknown) => {
        if (errorCode(error) !== 'ENOENT') throw error
      })
    })
  }

  private entryDirectory(fingerprint: string): string {
    return path.join(this.root, fingerprint.slice('sha256:'.length))
  }

  private activePath(fingerprint: string): string {
    return path.join(this.entryDirectory(fingerprint), 'active.json')
  }

  private lockPath(fingerprint: string): string {
    return path.join(this.entryDirectory(fingerprint), 'active.lock')
  }

  private completedPath(entry: RemoteCreationEntry): string {
    return path.join(
      this.entryDirectory(entry.fingerprint),
      'completed',
      `${sha256(entry.idempotencyKey).slice('sha256:'.length)}.json`
    )
  }

  private async readActive(fingerprint: string): Promise<StoredRemoteCreationEntry> {
    const activePath = this.activePath(fingerprint)
    const stats = await fs.lstat(activePath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw journalError(
        'REMOTE_JOURNAL_INVALID',
        `Remote creation journal entry ${fingerprint} is not a regular file.`
      )
    }
    await fs.chmod(activePath, 0o600)
    try {
      return decodeEntry(JSON.parse(await fs.readFile(activePath, 'utf8')), fingerprint)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw journalError(
          'REMOTE_JOURNAL_INVALID',
          `Remote creation journal entry ${fingerprint} contains invalid JSON.`
        )
      }
      throw error
    }
  }

  private async readMatchingActive(
    entry: RemoteCreationEntry
  ): Promise<StoredRemoteCreationEntry> {
    const current = await this.readActive(entry.fingerprint)
    if (current.idempotencyKey !== entry.idempotencyKey) {
      throw journalError(
        'REMOTE_JOURNAL_CONFLICT',
        'Remote creation journal entry changed during this invocation.'
      )
    }
    return current
  }

  private async readCompleted(
    entry: RemoteCreationEntry
  ): Promise<StoredRemoteCreationEntry> {
    const completed = decodeEntry(
      JSON.parse(await fs.readFile(this.completedPath(entry), 'utf8')),
      entry.fingerprint
    )
    if (
      completed.state !== 'completed' ||
      completed.idempotencyKey !== entry.idempotencyKey
    ) {
      throw journalError(
        'REMOTE_JOURNAL_CONFLICT',
        'Remote creation journal completed entry does not match this invocation.'
      )
    }
    return completed
  }

  private async acquireEntryLock(fingerprint: string): Promise<string> {
    const token = crypto.randomBytes(16).toString('hex')
    const lockPath = this.lockPath(fingerprint)
    const deadline = Date.now() + LOCK_TIMEOUT_MILLISECONDS
    for (;;) {
      const temporaryPath = `${lockPath}.${this.processId}.${token}`
      try {
        await fs.writeFile(temporaryPath, `${JSON.stringify({
          ownerPid: this.processId,
          token
        })}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        await fs.chmod(temporaryPath, 0o600)
        await fs.link(temporaryPath, lockPath)
        await fs.chmod(lockPath, 0o600)
        return token
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error
      } finally {
        await fs.unlink(temporaryPath).catch((error: unknown) => {
          if (errorCode(error) !== 'ENOENT') throw error
        })
      }

      let existing: StoredRemoteCreationLock
      try {
        existing = decodeLock(JSON.parse(await fs.readFile(lockPath, 'utf8')))
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue
        throw error
      }
      if (!this.processIsAlive(existing.ownerPid)) {
        let confirmed: StoredRemoteCreationLock
        try {
          confirmed = decodeLock(JSON.parse(await fs.readFile(lockPath, 'utf8')))
        } catch (error) {
          if (errorCode(error) === 'ENOENT') continue
          throw error
        }
        if (confirmed.token === existing.token) {
          await fs.unlink(lockPath).catch((error: unknown) => {
            if (errorCode(error) !== 'ENOENT') throw error
          })
        }
        continue
      }
      if (Date.now() >= deadline) {
        throw journalError(
          'REMOTE_JOURNAL_BUSY',
          'Remote creation journal entry is busy.'
        )
      }
      await delay(LOCK_RETRY_MILLISECONDS)
    }
  }

  private async releaseEntryLock(
    fingerprint: string,
    token: string
  ): Promise<void> {
    const lockPath = this.lockPath(fingerprint)
    const current = decodeLock(JSON.parse(await fs.readFile(lockPath, 'utf8')))
    if (current.token !== token) {
      throw journalError(
        'REMOTE_JOURNAL_CONFLICT',
        'Remote creation journal lock changed during this invocation.'
      )
    }
    await fs.unlink(lockPath)
  }

  private async withEntryLock<T>(
    fingerprint: string,
    action: () => Promise<T>
  ): Promise<T> {
    const token = await this.acquireEntryLock(fingerprint)
    try {
      return await action()
    } finally {
      await this.releaseEntryLock(fingerprint, token)
    }
  }

  private async replaceActive(entry: StoredRemoteCreationEntry): Promise<void> {
    const activePath = this.activePath(entry.fingerprint)
    const temporaryPath = `${activePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}`
    try {
      await writeRestricted(temporaryPath, entry, 'wx')
      await fs.rename(temporaryPath, activePath)
    } finally {
      await fs.unlink(temporaryPath).catch((error: unknown) => {
        if (errorCode(error) !== 'ENOENT') throw error
      })
    }
  }
}
