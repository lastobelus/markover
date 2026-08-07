import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const loadModule = createRequire(__filename)
const loadedElectron: unknown = loadModule('electron')
if (typeof loadedElectron !== 'string') {
  throw new Error('Electron executable path is unavailable.')
}
const electronPath = loadedElectron
const appDirectory = path.resolve(__dirname, '../app')

const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, [appDirectory, ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit'
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal))
}
