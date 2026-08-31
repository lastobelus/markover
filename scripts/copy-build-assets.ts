import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const buildDirectory = path.resolve(__dirname, '..')
const projectDirectory = path.resolve(buildDirectory, '..')

const sourceCodeExtension = /\.(?:[cm]?[jt]s|map)$/
type CopyOptions = NonNullable<Parameters<typeof cp>[2]>

async function copy(
  relativePath: string,
  options: CopyOptions = {}
): Promise<void> {
  await cp(
    path.join(projectDirectory, relativePath),
    path.join(buildDirectory, relativePath),
    { recursive: true, ...options }
  )
}

async function main(): Promise<void> {
  await mkdir(buildDirectory, { recursive: true })

  for (const relativePath of ['.github', 'examples']) {
    await copy(relativePath)
  }

  for (const name of [
    'markover-app-icon.icns',
    'markover-app-icon.png',
    'markover-lockup.svg',
    'markover-logotype.svg',
    'markover-mark.svg'
  ]) {
    await copy(`design/brand/${name}`)
  }

  await copy('docs', {
    filter: (source: string) => !sourceCodeExtension.test(source)
  })

  for (const relativePath of [
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'favicon.svg',
    'package.json',
    'packages/cli/package.json',
    'scripts/lib/markover-action-kit.js'
  ]) {
    await copy(relativePath)
  }
}

void main()
