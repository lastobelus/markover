#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectDirectory = path.resolve(__dirname, '..')
const sourcePath = path.join(
  projectDirectory,
  'design/brand/markover-app-icon.png'
)
const outputPath = path.join(
  projectDirectory,
  'design/brand/markover-app-icon.icns'
)

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `${path.basename(command)} exited ${result.status}`
    )
  }
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Building the macOS icon requires macOS.')
  }

  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'markover-icon-')
  )
  const iconsetPath = path.join(temporaryDirectory, 'Markover.iconset')
  fs.mkdirSync(iconsetPath)

  const variants = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]

  try {
    for (const [size, filename] of variants) {
      run('/usr/bin/sips', [
        '-z',
        String(size),
        String(size),
        sourcePath,
        '--out',
        path.join(iconsetPath, filename)
      ])
    }
    run('/usr/bin/iconutil', [
      '-c',
      'icns',
      iconsetPath,
      '-o',
      outputPath
    ])
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`markover icon: ${error.message}\n`)
    process.exit(1)
  }
}

module.exports = { main }
