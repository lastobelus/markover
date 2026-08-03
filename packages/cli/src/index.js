const packageJson = require('../package.json')
process.env.MARKOVER_INVOCATION ||= [
  'npx --yes',
  `--package=https://github.com/lastobelus/markover/releases/download/v${packageJson.version}/markover-cli.tgz`,
  'markover'
].join(' ')
const markover = require('../../../scripts/markover')
const { ensureInstalledApp } = require('./bootstrap')

async function main(args = process.argv.slice(2)) {
  let parsed
  try {
    parsed = markover.parseCommandArguments(args)
  } catch {
    await markover.main(args)
    return
  }
  if (parsed.command !== 'help') {
    try {
      process.env.MARKOVER_APP_PATH = await ensureInstalledApp({
        version: packageJson.version
      })
    } catch (error) {
      process.stderr.write(`markover bootstrap: ${error.message}\n`)
      process.exitCode = 1
      return
    }
  }
  await markover.main(args)
}

if (require.main === module) main()

module.exports = { main }
