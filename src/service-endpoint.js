const os = require('node:os')
const path = require('node:path')

function serviceDirectory({
  platform = process.platform,
  homeDirectory = os.homedir(),
  environment = process.env
} = {}) {
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'Markover')
  }
  if (platform === 'win32') {
    return path.join(environment.APPDATA || homeDirectory, 'Markover')
  }
  return path.join(
    environment.XDG_CONFIG_HOME || path.join(homeDirectory, '.config'),
    'Markover'
  )
}

function serviceEndpointPath(options) {
  return path.join(serviceDirectory(options), 'service.json')
}

module.exports = { serviceDirectory, serviceEndpointPath }
