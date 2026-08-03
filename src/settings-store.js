const fs = require('node:fs/promises')
const { watch } = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { normalizeSettings, updateSettings } = require('./settings')

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds)
})

function processIsRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

async function releaseOwnedLock(lockPath, owner) {
  const currentOwner = await fs.readlink(lockPath).catch(() => null)
  if (currentOwner === owner) await fs.unlink(lockPath).catch(() => {})
}

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath
    this.settings = normalizeSettings()
    this.writer = Promise.resolve()
    this.writeSequence = 0
    this.watcher = null
  }

  async read() {
    try {
      return normalizeSettings(
        JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      )
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error
      return normalizeSettings()
    }
  }

  async load() {
    this.settings = await this.read()
    return { ...this.settings }
  }

  async update(patch) {
    const sequence = ++this.writeSequence
    this.writer = this.writer.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const lockPath = `${this.filePath}.lock`
      const owner = `${process.pid}:${randomUUID()}`
      let ownsLock = false
      for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
          await fs.symlink(owner, lockPath)
          ownsLock = true
          break
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
          const observedOwner = await fs.readlink(lockPath).catch(() => '')
          const ownerPid = Number.parseInt(observedOwner.split(':')[0], 10)
          if (Number.isInteger(ownerPid) && !processIsRunning(ownerPid)) {
            await releaseOwnedLock(lockPath, observedOwner)
          }
          await wait(10)
        }
      }
      if (!ownsLock) throw new Error('Timed out waiting to update Markover settings.')

      const temporaryPath = `${this.filePath}.${process.pid}.${sequence}.tmp`
      try {
        const snapshot = updateSettings(await this.read(), patch)
        await fs.writeFile(
          temporaryPath,
          `${JSON.stringify(snapshot, null, 2)}\n`,
          'utf8'
        )
        await fs.rename(temporaryPath, this.filePath)
        this.settings = snapshot
        return { ...snapshot }
      } finally {
        await fs.unlink(temporaryPath).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
        await releaseOwnedLock(lockPath, owner)
      }
    })
    return this.writer
  }

  async subscribe(listener) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    let refreshTimer = null
    const refresh = async () => {
      try {
        const settings = await this.read()
        if (JSON.stringify(settings) === JSON.stringify(this.settings)) return
        this.settings = settings
        listener({ ...settings })
      } catch {
        // Ignore transient reads; the next file-system event retries refresh.
      }
    }
    this.watcher = watch(
      path.dirname(this.filePath),
      { persistent: false },
      (_event, filename) => {
        if (String(filename) !== path.basename(this.filePath)) return
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(refresh, 25)
      }
    )
    await refresh()
    return () => {
      clearTimeout(refreshTimer)
      this.watcher?.close()
      this.watcher = null
    }
  }
}

module.exports = { SettingsStore }
