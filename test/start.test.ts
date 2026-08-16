import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  prepareResolvedInstance,
  resolvedLaunchTarget
} from '../scripts/start'
import type { ResolvedInstance } from '../src/instance'

function instance(
  kind: 'canonical' | 'development'
): ResolvedInstance {
  const checkout = '/checkouts/markover'
  const stateRoot = kind === 'canonical'
    ? '/state/markover'
    : path.join(checkout, '.markover', 'instance')
  const identity = kind === 'canonical'
    ? { kind: 'canonical' as const, key: 'canonical' as const }
    : {
        kind: 'development' as const,
        key: 'pr-169' as const,
        pullRequestNumber: 169
      }
  return {
    version: 1,
    identity,
    stateRoot,
    checkout,
    service: {
      root: stateRoot,
      endpointPath: path.join(stateRoot, 'service.json'),
      tokenPath: path.join(stateRoot, 'service.token'),
      singleInstanceLockRoot: stateRoot
    },
    scheme: kind === 'canonical' ? 'markover' : 'markover-169',
    process: { status: 'stopped' },
    coldStart: { eligible: true, blockedBy: null },
    branding: kind === 'canonical'
      ? {
          appName: 'Markover',
          headerBadge: null,
          iconLabel: null,
          iconSvgPath: 'design/brand/markover-app-icon.svg',
          iconPngPath: 'design/brand/markover-app-icon.png',
          iconIcnsPath: 'design/brand/markover-app-icon.icns'
        }
      : {
          appName: 'Markover-169',
          headerBadge: 'PR 169',
          iconLabel: '169',
          iconSvgPath: path.join(
            checkout,
            '.markover/generated/pr-169/markover-app-icon.svg'
          ),
          iconPngPath: path.join(
            checkout,
            '.markover/generated/pr-169/markover-app-icon.png'
          ),
          iconIcnsPath: path.join(
            checkout,
            '.markover/generated/pr-169/markover-app-icon.icns'
          )
        },
    pullRequest: kind === 'canonical'
      ? null
      : { number: 169, state: 'open' }
  }
}

test('only development startup prepares an addressed bundle', async () => {
  const prepared: string[] = []
  const build = (target: ResolvedInstance) => {
    prepared.push(target.identity.key)
    return Promise.resolve()
  }
  await prepareResolvedInstance(instance('canonical'), build)
  await prepareResolvedInstance(instance('development'), build)
  assert.deepEqual(prepared, ['pr-169'])
})

test('development launches its app executable while canonical stays raw', () => {
  const appArguments = ['--markover-server']
  assert.deepEqual(
    resolvedLaunchTarget(instance('development'), appArguments, '/Electron'),
    {
      executable: path.join(
        '/checkouts/markover',
        '.markover',
        'generated',
        'pr-169',
        'bundle',
        'Markover-169.app',
        'Contents',
        'MacOS',
        'Markover-169'
      ),
      args: appArguments
    }
  )
  assert.deepEqual(
    resolvedLaunchTarget(instance('canonical'), appArguments, '/Electron'),
    {
      executable: '/Electron',
      args: [path.join(process.cwd(), 'build', 'app'), ...appArguments]
    }
  )
})
