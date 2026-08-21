import fs from 'node:fs/promises'
import path from 'node:path'

import {
  build as esbuild,
  type BuildOptions,
  type Metafile
} from 'esbuild'

import { brandAssetNames } from './app-layout'

const defaultProjectDirectory = path.resolve(__dirname, '../..')

const staticInputs = [
  'src/index.html',
  'src/styles.css',
  ...brandAssetNames.map((name) => `design/brand/${name}`)
] as const

export type DevelopmentRendererBuild = (
  options: BuildOptions
) => Promise<{ metafile: Metafile }>

export interface DevelopmentRendererOptions {
  build?: DevelopmentRendererBuild
  projectDirectory?: string
  publishedDirectory: string
}

export interface DevelopmentRendererResult {
  inputPaths: string[]
  publishedDirectory: string
}

function normalizeProjectPath(
  projectDirectory: string,
  inputPath: string
): string {
  const relative = path.isAbsolute(inputPath)
    ? path.relative(projectDirectory, inputPath)
    : inputPath
  return relative.split(path.sep).join('/').replace(/^\.\//, '')
}

async function copyFile(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
}

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    return error.code
  }
  return null
}

async function movePublishedAside(
  publishedDirectory: string,
  parent: string,
  name: string
): Promise<string | null> {
  const previousDirectory = await fs.mkdtemp(
    path.join(parent, `.${name}.previous-`)
  )
  await fs.rmdir(previousDirectory)
  try {
    await fs.rename(publishedDirectory, previousDirectory)
    return previousDirectory
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

async function replacePublishedDirectory(
  stagedDirectory: string,
  publishedDirectory: string
): Promise<void> {
  const parent = path.dirname(publishedDirectory)
  const name = path.basename(publishedDirectory)
  await fs.mkdir(parent, { recursive: true })

  const previousDirectory = await movePublishedAside(
    publishedDirectory,
    parent,
    name
  )
  try {
    await fs.rename(stagedDirectory, publishedDirectory)
  } catch (error) {
    if (previousDirectory !== null) {
      await fs.rename(previousDirectory, publishedDirectory)
    }
    throw error
  }
  if (previousDirectory !== null) {
    await fs.rm(previousDirectory, { recursive: true, force: true })
  }
}

export async function buildDevelopmentRenderer({
  build = esbuild as DevelopmentRendererBuild,
  projectDirectory = defaultProjectDirectory,
  publishedDirectory
}: DevelopmentRendererOptions): Promise<DevelopmentRendererResult> {
  const resolvedProjectDirectory = path.resolve(projectDirectory)
  const resolvedPublishedDirectory = path.resolve(publishedDirectory)
  const parent = path.dirname(resolvedPublishedDirectory)
  const name = path.basename(resolvedPublishedDirectory)
  await fs.mkdir(parent, { recursive: true })
  const stagedDirectory = await fs.mkdtemp(path.join(parent, `.${name}.building-`))
  const sourceDirectory = path.join(stagedDirectory, 'src')
  const metafiles: Metafile[] = []

  try {
    for (const input of staticInputs) {
      await copyFile(
        path.join(resolvedProjectDirectory, input),
        path.join(stagedDirectory, input)
      )
    }

    const preload = await build({
      absWorkingDir: resolvedProjectDirectory,
      bundle: true,
      entryPoints: ['src/preload.ts'],
      external: ['electron'],
      format: 'cjs',
      logLevel: 'warning',
      metafile: true,
      outfile: path.join(sourceDirectory, 'preload.js'),
      platform: 'node',
      sourcemap: 'external',
      sourcesContent: true,
      target: 'node22'
    })
    metafiles.push(preload.metafile)

    const startup = await build({
      absWorkingDir: resolvedProjectDirectory,
      bundle: true,
      entryPoints: ['src/startup.ts'],
      format: 'iife',
      logLevel: 'warning',
      metafile: true,
      outfile: path.join(sourceDirectory, 'startup.js'),
      platform: 'browser',
      sourcemap: 'external',
      sourcesContent: true,
      target: 'chrome150'
    })
    metafiles.push(startup.metafile)

    const renderer = await build({
      absWorkingDir: resolvedProjectDirectory,
      bundle: true,
      entryPoints: ['src/renderer.ts'],
      format: 'esm',
      logLevel: 'warning',
      metafile: true,
      outfile: path.join(sourceDirectory, 'renderer.js'),
      platform: 'browser',
      sourcemap: 'external',
      sourcesContent: true,
      splitting: false,
      target: 'chrome150'
    })
    metafiles.push(renderer.metafile)

    const inputPaths = new Set<string>(staticInputs)
    for (const metafile of metafiles) {
      for (const inputPath of Object.keys(metafile.inputs)) {
        inputPaths.add(normalizeProjectPath(resolvedProjectDirectory, inputPath))
      }
    }

    await replacePublishedDirectory(stagedDirectory, resolvedPublishedDirectory)
    return {
      inputPaths: [...inputPaths].sort(),
      publishedDirectory: resolvedPublishedDirectory
    }
  } catch (error) {
    await fs.rm(stagedDirectory, { recursive: true, force: true })
    throw error
  }
}
