const { spawn } = require('node:child_process')
const electronPath = require('electron')

const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], {
  env: environment,
  stdio: 'inherit'
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
