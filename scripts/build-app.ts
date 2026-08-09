#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { build } from 'esbuild'

import {
  brandAssetNames,
  expectedStageEntries,
  runtimeModuleNames,
  verifyAppLayout
} from './app-layout'

const buildDirectory = path.resolve(__dirname, '..')
const projectDirectory = path.resolve(buildDirectory, '..')
const appDirectory = path.join(buildDirectory, 'app')
const appSourceDirectory = path.join(appDirectory, 'src')
const artifactsDirectory = path.join(buildDirectory, 'artifacts')

async function copyFile(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
}

function gitValue(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: projectDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null
  } catch {
    return null
  }
}

async function sha256(filePath: string): Promise<string> {
  return crypto.createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')
}

function manifestString(
  manifest: Record<string, unknown>,
  key: string
): string {
  const value = manifest[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`Root package.json must define ${key} as a string.`)
  }
  return value
}

async function main(): Promise<void> {
  await fs.rm(appDirectory, { recursive: true, force: true })
  await fs.mkdir(appSourceDirectory, { recursive: true })
  await fs.mkdir(artifactsDirectory, { recursive: true })

  for (const name of runtimeModuleNames) {
    for (const extension of ['js', 'js.map']) {
      await copyFile(
        path.join(buildDirectory, 'src', `${name}.${extension}`),
        path.join(appSourceDirectory, `${name}.${extension}`)
      )
    }
  }
  for (const name of ['index.html', 'styles.css']) {
    await copyFile(
      path.join(projectDirectory, 'src', name),
      path.join(appSourceDirectory, name)
    )
  }
  for (const name of brandAssetNames) {
    await copyFile(
      path.join(projectDirectory, 'design/brand', name),
      path.join(appDirectory, 'design/brand', name)
    )
  }

  await build({
    absWorkingDir: projectDirectory,
    bundle: true,
    entryPoints: ['src/preload.ts'],
    external: ['electron'],
    format: 'cjs',
    logLevel: 'warning',
    outfile: path.join(appSourceDirectory, 'preload.js'),
    platform: 'node',
    sourcemap: 'external',
    sourcesContent: true,
    target: 'node22'
  })

  await build({
    absWorkingDir: projectDirectory,
    bundle: true,
    entryPoints: ['src/startup.ts'],
    format: 'iife',
    logLevel: 'warning',
    outfile: path.join(appSourceDirectory, 'startup.js'),
    platform: 'browser',
    sourcemap: 'external',
    sourcesContent: true,
    target: 'chrome150'
  })

  const result = await build({
    absWorkingDir: projectDirectory,
    bundle: true,
    entryPoints: ['src/renderer.ts'],
    format: 'esm',
    logLevel: 'warning',
    metafile: true,
    outfile: path.join(appSourceDirectory, 'renderer.js'),
    platform: 'browser',
    sourcemap: 'external',
    sourcesContent: true,
    splitting: false,
    target: 'chrome150'
  })

  const rootManifest: unknown = JSON.parse(await fs.readFile(
    path.join(projectDirectory, 'package.json'),
    'utf8'
  ))
  if (
    rootManifest === null ||
    typeof rootManifest !== 'object' ||
    Array.isArray(rootManifest)
  ) {
    throw new Error('Root package.json must contain an object.')
  }
  const manifest = rootManifest as Record<string, unknown>
  const stagedManifest = {
    name: manifestString(manifest, 'name'),
    productName: manifestString(manifest, 'productName'),
    version: manifestString(manifest, 'version'),
    description: manifestString(manifest, 'description'),
    main: 'src/main.js',
    author: manifestString(manifest, 'author'),
    license: manifestString(manifest, 'license')
  }
  await fs.writeFile(
    path.join(appDirectory, 'package.json'),
    `${JSON.stringify(stagedManifest, null, 2)}\n`,
    'utf8'
  )

  const rendererPath = path.join(appSourceDirectory, 'renderer.js')
  const sourceMapPath = `${rendererPath}.map`
  const commit = gitValue(['rev-parse', 'HEAD'])
  const dirty = Boolean(gitValue(['status', '--porcelain', '--untracked-files=all']))
  const buildIdentity = {
    version: stagedManifest.version,
    commit,
    dirty,
    rendererSha256: await sha256(rendererPath)
  }
  await fs.writeFile(
    path.join(appDirectory, 'build-identity.json'),
    `${JSON.stringify(buildIdentity, null, 2)}\n`,
    'utf8'
  )
  const layoutManifest = {
    format: 'markover-app-layout',
    version: 1,
    buildIdentity,
    entries: expectedStageEntries,
    sizes: {
      rendererBytes: (await fs.stat(rendererPath)).size,
      rendererSourceMapBytes: (await fs.stat(sourceMapPath)).size
    }
  }
  await fs.writeFile(
    path.join(artifactsDirectory, 'renderer-metafile.json'),
    `${JSON.stringify(result.metafile, null, 2)}\n`,
    'utf8'
  )
  await fs.writeFile(
    path.join(artifactsDirectory, 'app-layout.json'),
    `${JSON.stringify(layoutManifest, null, 2)}\n`,
    'utf8'
  )

  await verifyAppLayout(appDirectory)
}

void main()
