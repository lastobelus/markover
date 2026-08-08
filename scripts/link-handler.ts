#!/usr/bin/env node

import {
  resolveInstance,
  type ResolvedInstance
} from '../src/instance'
import {
  inspectLinkHandler,
  installLinkHandler,
  removeLinkHandler
} from '../src/link-handler'
import { isReviewInstanceScheme } from '../src/review-url'

type Target = 'canonical' | 'development'

type ParsedCommand =
  | { command: 'help' }
  | {
      command: 'install' | 'repair' | 'replace'
      target: Target
    }
  | {
      command: 'status'
      target: Target
      scheme: string | null
    }
  | {
      command: 'remove'
      scheme: string
      force: boolean
    }

export function linkHandlerHelp() {
  return {
    format: 'markover-link-handler-help',
    version: 1,
    purpose: 'Manage forwarding-only macOS review-link handlers for exact Markover instances.',
    commands: [
      '[--instance canonical|dev] install',
      '[--instance canonical|dev] status',
      'status <markover[-N]>',
      '[--instance canonical|dev] repair',
      '[--instance canonical|dev] replace',
      'remove <markover[-N]> [--force]',
      'help'
    ],
    behavior: 'Handlers forward only to an already-running exact instance. They never build, launch, search, or mutate a checkout.'
  }
}

function commandError(message: string): Error {
  return new Error(`${message} Run "npm --silent run link-handler -- help" for usage.`)
}

export function parseLinkHandlerArguments(args: string[]): ParsedCommand {
  if (!args.length || args[0] === 'help' || args[0] === '--help') {
    return { command: 'help' }
  }
  let target: Target = 'canonical'
  let rest = args
  if (args[0] === '--instance') {
    if (args[1] !== 'canonical' && args[1] !== 'dev') {
      throw commandError('--instance requires canonical or dev.')
    }
    target = args[1] === 'dev' ? 'development' : 'canonical'
    rest = args.slice(2)
  }
  if (rest.includes('--instance')) {
    throw commandError('--instance must precede the command.')
  }
  const command = rest[0]
  if (
    command === 'install' ||
    command === 'repair' ||
    command === 'replace'
  ) {
    if (rest.length !== 1) throw commandError(`${command} takes no arguments.`)
    return { command, target }
  }
  if (command === 'status') {
    if (rest.length > 2) throw commandError('status accepts at most one scheme.')
    const scheme = rest[1] || null
    if (scheme && !isReviewInstanceScheme(scheme)) {
      throw commandError('status requires markover or one exact markover-N scheme.')
    }
    return { command, target, scheme }
  }
  if (command === 'remove') {
    const scheme = rest[1]
    const force = rest[2] === '--force'
    if (
      !scheme ||
      !isReviewInstanceScheme(scheme) ||
      rest.length > (force ? 3 : 2)
    ) {
      throw commandError('remove requires one exact markover[-N] scheme and optional --force.')
    }
    return { command, scheme, force }
  }
  throw commandError(`Unknown link-handler command: ${command || '(missing)'}.`)
}

export interface ExecuteLinkHandlerOptions {
  resolve?: (target: Target) => Promise<ResolvedInstance>
}

export async function executeLinkHandlerCommand(
  parsed: ParsedCommand,
  { resolve = resolveInstance }: ExecuteLinkHandlerOptions = {}
): Promise<unknown> {
  if (parsed.command === 'help') return linkHandlerHelp()
  if (parsed.command === 'remove') {
    return removeLinkHandler(parsed.scheme, { force: parsed.force })
  }
  if (parsed.command === 'status' && parsed.scheme) {
    return inspectLinkHandler(parsed.scheme)
  }
  const instance = await resolve(parsed.target)
  if (parsed.command === 'status') {
    return inspectLinkHandler(instance.scheme, instance)
  }
  return installLinkHandler(parsed.command, instance)
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  try {
    const result = await executeLinkHandlerCommand(
      parseLinkHandlerArguments(args)
    )
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover link handler: ${message}\n`)
    process.exitCode = 1
  }
}

if (require.main === module) void main()
