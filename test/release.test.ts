import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(__dirname, '../..')
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), 'utf8')

interface PackageManifest {
  bin: { markover: string }
  dependencies?: Record<string, string>
  devDependencies: Record<string, string>
  engines: { node: string }
  files?: string[]
  main: string
  scripts: Record<string, string>
  version: string
}

interface TypeScriptConfig {
  compilerOptions: {
    allowJs: boolean
    checkJs: boolean
    exactOptionalPropertyTypes: boolean
    noUncheckedIndexedAccess: boolean
    outDir: string
    strict: boolean
  }
}

function readJson(relativePath: string): unknown {
  return JSON.parse(read(relativePath)) as unknown
}

test('release workflow publishes both Mac architectures and the tiny CLI', () => {
  const workflow = read('.github/workflows/release.yml')
  const rootPackage = readJson('package.json') as PackageManifest
  const cliPackage = readJson('packages/cli/package.json') as PackageManifest

  assert.equal(cliPackage.version, rootPackage.version)
  assert.equal(cliPackage.bin.markover, 'bin/markover.js')
  assert.equal(cliPackage.dependencies, undefined)
  assert.deepEqual(cliPackage.files, ['bin/markover.js'])
  assert.match(workflow, /macos-15\n/)
  assert.match(workflow, /macos-15-intel/)
  assert.match(workflow, /Verify tag matches package version/)
  assert.match(workflow, /GITHUB_REF_NAME/)
  assert.match(workflow, /Markover-darwin-\$\{architecture\}\.zip/)
  assert.match(workflow, /shasum -a 256/)
  assert.match(workflow, /markover-cli\.tgz/)
  assert.match(workflow, /gh release create/)
})

test('README exposes the repository-only install-free agent command', () => {
  const readme = read('README.md')
  const entry = read('packages/cli/src/index.ts')

  for (const source of [readme, entry]) {
    assert.match(
      source,
      /https:\/\/github\.com\/lastobelus\/markover\/releases\/latest\/download\/markover-cli\.tgz/
    )
  }
  assert.match(readme, /retain the returned `reviewId`/)
  assert.match(readme, /“Check\nMarkover,” run the same launcher with `get <reviewId>`/)
})

test('continuous integration enforces the supported Node versions', () => {
  const workflow = read('.github/workflows/ci.yml')
  const developmentGuide = read('docs/development.md')
  const rootPackage = readJson('package.json') as PackageManifest
  const cliPackage = readJson('packages/cli/package.json') as PackageManifest

  assert.equal(rootPackage.engines.node, '>=22.13.0')
  assert.equal(cliPackage.engines.node, '>=22.13.0')
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /timeout-minutes: 3/)
  assert.match(workflow, /fail-fast: false/)
  assert.match(workflow, /- '22\.13\.0'/)
  assert.match(workflow, /- '24'/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /permissions:\n {2}contents: read/)
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
  assert.match(workflow, /npm ci/)
  assert.match(workflow, /npm run check/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /git diff --exit-code/)
  assert.equal(rootPackage.scripts.pretest, 'install-electron --no')
  assert.match(developmentGuide, /Require approval for all external\s+contributors/)
  assert.match(developmentGuide, /approval_policy=all_external_contributors/)
  assert.match(developmentGuide, /requires review\s+conversations to be resolved/)
  assert.match(developmentGuide, /Use squash merges; disable merge\s+commits and rebase merges/)

  for (const source of [
    read('README.md'),
    developmentGuide,
    read('docs/guide/index.html')
  ]) {
    assert.match(source, /Node\.js 22\.13\.0 or newer/)
    assert.doesNotMatch(source, /Node\.js 20/)
  }
})

test('TypeScript build is strict, generated, and runtime-loader free', () => {
  const packageJson = readJson('package.json') as PackageManifest
  const tsconfig = readJson('tsconfig.json') as TypeScriptConfig
  const gitignore = read('.gitignore')

  assert.equal(packageJson.main, 'build/src/main.js')
  assert.equal(packageJson.bin.markover, 'build/scripts/markover.js')
  assert.equal(
    packageJson.devDependencies['@typescript/native'],
    'npm:typescript@^7.0.2'
  )
  assert.equal(
    packageJson.devDependencies.typescript,
    'npm:@typescript/typescript6@^6.0.2'
  )
  assert.equal(typeof packageJson.devDependencies['typescript-eslint'], 'string')
  assert.equal(tsconfig.compilerOptions.strict, true)
  assert.equal(tsconfig.compilerOptions.noUncheckedIndexedAccess, true)
  assert.equal(tsconfig.compilerOptions.exactOptionalPropertyTypes, true)
  assert.equal(tsconfig.compilerOptions.allowJs, true)
  assert.equal(tsconfig.compilerOptions.checkJs, false)
  assert.equal(tsconfig.compilerOptions.outDir, 'build')
  assert.match(gitignore, /^build\/$/m)
  assert.doesNotMatch(JSON.stringify(packageJson), /(?:ts-node|tsx)/)
  assert.equal(
    packageJson.scripts['build:icon:mac'],
    'npm run build --silent && node build/scripts/build-macos-icon.js'
  )
  assert.equal(fs.existsSync(path.join(root, 'src/pierre-diffs-entry.mts')), true)
  assert.equal(fs.existsSync(path.join(root, 'test/pierre-diffs-entry.test.ts')), true)
  for (const name of [
    'app-menu',
    'annotation-block',
    'annotations',
    'image-preview',
    'navigation',
    'review-sessions',
    'settings',
    'source-edits',
    'tree'
  ]) {
    assert.equal(fs.existsSync(path.join(root, `src/${name}.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `src/${name}.js`)), false)
    assert.equal(fs.existsSync(path.join(root, `test/${name}.test.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `test/${name}.test.js`)), false)
  }
  for (const name of ['main', 'preload']) {
    assert.equal(fs.existsSync(path.join(root, `src/${name}.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `src/${name}.js`)), false)
  }
  for (const name of ['background-focus']) {
    assert.equal(fs.existsSync(path.join(root, `test/${name}.test.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `test/${name}.test.js`)), false)
  }
  for (const name of [
    'local-client',
    'local-service',
    'metadata-discovery',
    'review-migration',
    'review-store',
    'service-endpoint',
    'settings-store'
  ]) {
    assert.equal(fs.existsSync(path.join(root, `src/${name}.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `src/${name}.js`)), false)
  }
  for (const name of [
    'local-service',
    'metadata-discovery',
    'review-migration',
    'review-store',
    'service-endpoint'
  ]) {
    assert.equal(fs.existsSync(path.join(root, `test/${name}.test.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `test/${name}.test.js`)), false)
  }
  for (const name of ['bootstrap', 'index']) {
    assert.equal(fs.existsSync(path.join(root, `packages/cli/src/${name}.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `packages/cli/src/${name}.js`)), false)
  }
  for (const name of [
    'build-cli',
    'build-macos-icon',
    'copy-build-assets',
    'generate-third-party-notices',
    'markover',
    'open-review',
    'package-macos',
    'review',
    'start'
  ]) {
    assert.equal(fs.existsSync(path.join(root, `scripts/${name}.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `scripts/${name}.js`)), false)
  }
  for (const name of [
    'bootstrap',
    'macos-package',
    'markover-cli',
    'open-review',
    'release',
    'review',
    'third-party-notices'
  ]) {
    assert.equal(fs.existsSync(path.join(root, `test/${name}.test.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `test/${name}.test.js`)), false)
  }
})
