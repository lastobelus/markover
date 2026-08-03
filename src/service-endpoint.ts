import os from 'node:os'
import path from 'node:path'

export interface ServiceDirectoryOptions {
  platform?: NodeJS.Platform
  homeDirectory?: string
  environment?: NodeJS.ProcessEnv
}

export function serviceDirectory({
  platform = process.platform,
  homeDirectory = os.homedir(),
  environment = process.env
}: ServiceDirectoryOptions = {}): string {
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

export function serviceEndpointPath(options?: ServiceDirectoryOptions): string {
  return path.join(serviceDirectory(options), 'service.json')
}

export function reviewsDirectory(options?: ServiceDirectoryOptions): string {
  return path.join(serviceDirectory(options), 'reviews')
}
