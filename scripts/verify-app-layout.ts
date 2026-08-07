#!/usr/bin/env node

import path from 'node:path'

import { verifyAppLayout } from './app-layout'

const appDirectory = path.resolve(__dirname, '../app')

verifyAppLayout(appDirectory).then(() => {
  process.stdout.write('Verified build/app layout.\n')
}).catch((error: unknown) => {
  process.stderr.write(
    `markover app layout: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
})
