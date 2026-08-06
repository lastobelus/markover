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
  assert.match(
    workflow,
    /Verify stable tag, protected-main ancestry, and required CI/
  )
  assert.match(workflow, /GITHUB_REF_NAME/)
  assert.match(workflow, /Markover-darwin-\$\{architecture\}\.zip/)
  assert.match(workflow, /shasum -a 256/)
  assert.match(workflow, /Verify final macOS artifact/)
  assert.match(workflow, /release:preflight -- verify-macos/)
  assert.match(workflow, /--trust-mode=ad-hoc/)
  assert.match(workflow, /markover-cli\.tgz/)
  assert.match(workflow, /gh release create/)
  assert.match(workflow, /permissions: \{\}/)
  assert.match(workflow, /attestations: write/)
  assert.match(workflow, /actions\/attest@[a-f0-9]{40}/)
  assert.match(workflow, /--source-digest "\$GITHUB_SHA"/)
  assert.match(workflow, /--source-ref "\$GITHUB_REF"/)
  assert.match(workflow, /--deny-self-hosted-runners/)
  assert.match(workflow, /--draft/)
  assert.match(workflow, /environment:\n\s+name: release/)
  assert.match(workflow, /Wait for every older release run/)
  assert.match(workflow, /publication-turn/)
  assert.match(workflow, /select-rollback/)
  assert.doesNotMatch(workflow, /group: release-publication/)
  assert.match(workflow, /compare-payloads/)
  assert.match(workflow, /releases\/assets\/\$\{asset_id\}/)
  assert.match(workflow, /verify-rollback/)
  assert.match(workflow, /publish the unchanged immutable release/)
  assert.match(workflow, /final-draft-release\.json/)
  assert.match(workflow, /final-candidate/)
  assert.match(workflow, /-F draft=false/)
  assert.ok(
    workflow.indexOf('Wait for every older release run') <
      workflow.indexOf('Select the current known-good rollback release')
  )
  assert.ok(
    workflow.indexOf('Select the current known-good rollback release') <
      workflow.indexOf('Assemble complete draft release')
  )
  const actionReferences = [...workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g)]
  assert.ok(actionReferences.length > 0)
  for (const reference of actionReferences) {
    assert.match(reference[1] ?? '', /^[a-f0-9]{40}$/)
  }
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

test('release documentation states the Sonoma and ad-hoc trust boundary', () => {
  const sources = [
    read('README.md'),
    read('docs/guide/index.html'),
    read('docs/development.md')
  ]
  for (const source of sources) {
    assert.match(source, /macOS 14 Sonoma/)
    assert.match(source, /not Apple-verified/i)
    assert.match(source, /Apple Developer Program/)
    assert.doesNotMatch(source, /xattr\s+-[a-zA-Z]*r/)
  }
  assert.match(sources[0] ?? '', /## Opening Markover on macOS/)
  assert.match(sources[1] ?? '', /System Settings → Privacy &amp; Security/)
})

test('signing preflight ELI5 stays interlinked and truth-scoped', () => {
  const directory =
    'doc/plans/2026-08-03__signing-notarization-preflight-eli5'
  const pages = ['index.html', 'slice-1.html', 'release-roadmap.html']
    .map((name) => read(`${directory}/${name}`))
  for (const page of pages) {
    assert.match(page, /<nav class="tabs"/)
    assert.match(page, /href="index\.html"/)
    assert.match(page, /href="slice-1\.html"/)
    assert.match(page, /href="release-roadmap\.html"/)
    assert.match(page, /<details class="card truth-context">/)
    assert.match(page, /Where This Is True/)
    assert.match(page, /<svg[^>]+role="img"/)
    assert.doesNotMatch(page, /<script[^>]+src=/)
    assert.doesNotMatch(page, /<link[^>]+rel="stylesheet"/)
    assert.ok(
      page.indexOf('<details class="card truth-context">') <
        page.indexOf('The Tiny Story')
    )
  }
  assert.match(
    pages[0] ?? '',
    /Slice 2 · Ready PR #55 · 5 Aug 2026/
  )
  assert.match(
    pages[1] ?? '',
    /PR #45 merged · Implemented on main · 5 Aug 2026/
  )
  assert.match(
    pages[2] ?? '',
    /Slice 2 · Ready PR #55 · 5 Aug 2026/
  )
})

test('public release runbook preserves provenance and rollback boundaries', () => {
  const runbook = read('docs/releasing.md')
  const sources = [
    read('README.md'),
    read('docs/development.md'),
    read('docs/guide/index.html')
  ]

  assert.match(runbook, /not\s+Apple-verified/i)
  assert.match(runbook, /github-readiness/)
  assert.match(runbook, /protected `release` environment/)
  assert.match(runbook, /gh attestation verify/)
  assert.match(runbook, /version-pinned launcher/i)
  assert.match(runbook, /Application Support\/Markover/)
  assert.match(runbook, /Never reuse the withdrawn tag/i)
  assert.match(runbook, /Developer ID activation/)
  for (const source of sources) assert.match(source, /releas(?:e|ing)\.md/)
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
  assert.equal('allowJs' in tsconfig.compilerOptions, false)
  assert.equal('checkJs' in tsconfig.compilerOptions, false)
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
    'agent-guidance',
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
  assert.equal(fs.existsSync(path.join(root, 'docs/site.ts')), true)
  assert.equal(fs.existsSync(path.join(root, 'docs/site.js')), false)
  assert.equal(
    fs.existsSync(path.join(root, 'test/community-surface.test.ts')),
    true
  )
  assert.equal(
    fs.existsSync(path.join(root, 'test/docs-site.test.ts')),
    true
  )
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
    'macos-artifact-preflight',
    'macos-release-contract',
    'open-review',
    'package-macos',
    'release-preflight',
    'review',
    'start'
  ]) {
    assert.equal(fs.existsSync(path.join(root, `scripts/${name}.ts`)), true)
    assert.equal(fs.existsSync(path.join(root, `scripts/${name}.js`)), false)
  }
  for (const name of [
    'bootstrap',
    'macos-artifact-preflight',
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
