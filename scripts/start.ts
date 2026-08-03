import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const loadModule = createRequire(__filename)
const loadedElectron: unknown = loadModule('electron')
if (typeof loadedElectron !== 'string') {
  throw new Error('Electron executable path is unavailable.')
}
const electronPath = loadedElectron

const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], {
  env: environment,
  stdio: 'inherit'
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal))
}
