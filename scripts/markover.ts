#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  LocalServiceError,
  probeService,
  readEndpoint,
  requestJson,
  requestServiceQuit
} from '../src/local-client'
import {
  readRemoteHealth,
  RemoteClientError,
  requestRemoteJson,
  type RemoteHealth,
  type RemoteJsonRequestOptions
} from '../src/remote-client'
import {
  RemoteCreationJournal,
  RemoteCreationJournalError,
  type RemoteCreationEntry,
  type RemoteCreationReceipt
} from '../src/remote-creation-journal'
import {
  loadRemoteProfile,
  REMOTE_PROFILE_ENVIRONMENT_VARIABLE,
  type RemoteProfile
} from '../src/remote-profile'
import {
  discoverReviewMetadata,
  HANDOFF_KEY_PATTERN,
  type ReviewMetadata,
  type ReviewMetadataInput
} from '../src/metadata-discovery'
import { serviceEndpointPath } from '../src/service-endpoint'
import { guidance } from '../src/agent-guidance'
import { normalizeSettings } from '../src/settings'
import { parseMarkdown } from '../src/tree'
import {
  cleanupDevelopmentInstance,
  type CleanupDevelopmentInstanceResult
} from '../src/instance-cleanup'
import {
  CANONICAL_INSTANCE_SCHEME,
  resolveInstance,
  resolvedInstanceEnvironment,
  RESOLVED_INSTANCE_ENVIRONMENT,
  type ResolvedInstance
} from '../src/instance'
import { canonicalApplicationAddress } from '../src/canonical-application'
import { reviewUrl } from '../src/review-url'
import {
  isPullRequestStatus,
  parseGitHubPullRequestUrl,
  type PullRequestStatus
} from '../src/pull-request'
import {
  decodeReviewArtifact,
  ReviewFormatError
} from '../src/review-format'
import {
  assertCanonicalReviewRoutingReady,
  inspectCanonicalHealth,
  type CanonicalDoctorResult
} from '../src/canonical-maintenance'
import {
  installLinkHandler,
  type LinkHandlerMutationResult
} from '../src/link-handler'
import { MAXIMUM_BODY_BYTES } from '../src/local-service'
import {
  REMOTE_GATEWAY_IDEMPOTENCY_HEADER,
  REMOTE_GATEWAY_REQUEST_DIGEST_HEADER
} from '../src/remote-gateway'
import {
  addressedDevelopmentBundle,
  type AddressedDevelopmentBundle
} from './development-bundle'
import {
  stageCanonicalApplication,
  type CanonicalApplicationTransaction
} from './canonical-application'

const defaultEndpointPath = serviceEndpointPath()

const helpAliases = new Set(['help', 'info', '--help', '-h'])

function invocation(): string {
  return process.env.MARKOVER_INVOCATION || 'npm --silent run markover --'
}

function recoveryHint(): string {
  return `Run "${invocation()} help" for complete usage.`
}

export type InstanceSelector = 'canonical' | 'development'

interface ParsedInstanceTarget {
  instance?: InstanceSelector
}

export type ParsedCommand = ParsedInstanceTarget & (
  | { command: 'help' }
  | { command: 'canonical'; action: 'doctor' }
  | { command: 'canonical'; action: 'refresh'; install: boolean }
  | { command: 'cleanup'; expectedIdentity: `pr-${number}` }
  | { command: 'edit'; reviewId: string }
  | {
      command: 'resolve'
      reviewId: string
      outcome: 'reviewed-no-notes' | 'accepted-unreviewed'
    }
  | { command: 'unresolve'; reviewId: string }
  | {
      command: 'pending'
      handoffKey?: string | null
      threadId?: string | null
      threadHostKind: string
      threadHostProvider: string
      threadHostThreadId?: string | null
      threadHostMachine?: string | null
    }
  | {
      command: 'get' | 'revise'
      reviewId: string
      pullRequestStatus?: PullRequestStatus | null
    }
  | {
      command: 'get-for-review'
      reviewId: string
      handoffKey?: string | null
      pullRequestStatus?: PullRequestStatus | null
      threadId?: string | null
      threadHostKind?: string | null
      threadHostProvider?: string | null
      threadHostThreadId?: string | null
      threadHostMachine?: string | null
    }
  | {
      command: 'submit'
      reviewId: string
      inputPath: string
    }
  | {
      command: 'done'
      pullRequestUrl: string
      pullRequestStatus: 'merged'
    }
  | {
      command: 'open'
      sourcePath: string
      contextSummary: string
      branch?: string | null
      handoffKey?: string | null
      pullRequestNumber?: number | null
      pullRequestUrl?: string | null
      pullRequestStatus?: PullRequestStatus | null
      threadId?: string | null
      threadHostKind?: string | null
      threadHostProvider?: string | null
      threadHostThreadId?: string | null
      threadHostMachine?: string | null
    }
)

export class CommandError extends Error {
  readonly usage: string | undefined

  constructor(message: string, usage?: string) {
    super(message)
    this.name = 'CommandError'
    this.usage = usage
  }
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object'
    ? Reflect.get(error, 'code')
    : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function commandError(message: string, usage?: string): CommandError {
  return new CommandError(message, usage)
}

export function helpPayload() {
  const defaultAgentGuidance = guidance()
  return {
    format: 'markover-help',
    version: 1,
    purpose: 'Review Markdown as a block tree and return structured feedback to an agent.',
    repository: 'https://github.com/lastobelus/markover',
    invocation: `${invocation()} [--instance <canonical|dev>] <command>`,
    requirements: {
      platform: 'macOS 14 Sonoma or newer (the local app is Apple Silicon only; remote author mode also supports Intel)',
      node: '22.13.0 or newer',
      installation: 'The install-free release launcher needs no installation; it downloads and caches the matching app on first local use. Configured remote author commands do not download or launch a local app.'
    },
    remoteCanonical: {
      configuration: `Set ${REMOTE_PROFILE_ENVIRONMENT_VARIABLE} to a JSON file containing exactly {"baseUrl":"https://<airy-host>.ts.net/"}.`,
      commands: ['open', 'pending', 'get', 'edit', 'revise', 'done'],
      behavior: 'A valid profile uses Airy’s canonical Markover without downloading, launching, or storing a second Markover app on the client Mac. Thread and Git discovery remain local; attachments and reviewer mode are unavailable.'
    },
    workflow: [
      'Create the Markdown file before opening it.',
      'Canonical review creation verifies that the configured development handler exactly owns markover: before creating the review. If routing is unhealthy, run canonical refresh from any checkout and retry open.',
      'Canonical refresh builds one addressed canonical bundle and installs it at /Applications/Markover.app before launching it; pass --no-install to leave /Applications untouched and launch the same build from its owned generated path. It retains any replaced app until doctor proves the selected executable, bundle identity, build, service, electron-visible window, and routing. Cmd-Tab and Window > Bring All to Front are the normal macOS recovery paths to make that inactive window onscreen. Automatic review cold starts remain hidden.',
      'Run open once, then retain the returned reviewId in the agent thread.',
      'Give the user a best-effort Markdown link using reviewUrl, include the raw reviewId, put open \'<reviewUrl>\' alone on its own line as the reliable Terminal handoff, and wait for them to say "Check Markover."',
      'Run get once after that instruction; it returns the frozen markover-review JSON.',
      'Before interpreting a returned review, require format markover-review and version 1. For any other header, preserve the artifact, consult the official compatibility catalog named by the diagnostic, recommend the compatible Markover release when listed, and never guess at the body.',
      'Before acting, follow review.agentGuidance.fixedContract and review.agentGuidance.interpretationPolicy from that JSON.',
      'For every agent-originated open or get-for-review, use one truthful identity route. On a proven Codex surface, read only CODEX_THREAD_ID; on a proven Claude surface, read only CLAUDE_CODE_SESSION_ID. If that applicable value is nonblank, pass it as --thread-id. Otherwise create one fresh mko_handoff_ value with 16–64 random letters or digits and pass it as --handoff-key in the same command. With either route, pass --thread-host-kind for the user-facing product or lookup namespace, --thread-host-provider for the LLM provider or model family, not an intermediate harness, and the local hostname result as --thread-host-machine when available. Pass --thread-host-thread-id only for a distinct host-owned ID you actually observe; never guess a T3 thread ID.',
      'After acting on every part of the review, run revise once so Markover records the completed handoff.',
      'If the user asks about pending Markover reviews, run pending with the same truthful current-thread identity rules as open. Return every listed review; an empty list is the only no-pending result.',
      'Unresolved reviews are a soft gate: planning and implementation may continue, but before merging or declaring the agent thread complete, run pending and surface every result for an explicit disposition. Do not infer acceptance from silence or from a merged pull request.',
      'When the user chooses reviewed with no notes or accepted unreviewed, run resolve with that exact outcome. If feedback exists, Markover shows its preserved summary and requires the user to choose Abandon feedback. A cancellation leaves the review unresolved. Use unresolve to return a manual resolution to Needs me before Done.',
      'For a pull-request-associated review, attempt the pullRequestStatus lookup immediately before open, get, get-for-review, revise, and done. On open, pass its canonical url with --pr-url and its mapped status with --pr-status; on get, get-for-review, or revise, pass --pr-status. After a failed lookup, omit --pr-status and report the failure. On open, retain --pr and a known canonical --pr-url; when no canonical identity is known, omit the PR association. On get, get-for-review, or revise, preserving the review ID also preserves the last successful observation.',
      'After verifying a pull request merged, run done with its canonical URL and --pr-status merged; Markover marks every matching local review Done.',
      'If the user wants to add feedback before revise, run edit before asking them to continue. After revise, open a new review for a later feedback round.',
      'To act as reviewer, run get-for-review once with the retained review ID and truthful reviewer thread metadata. Follow review.agentReviewer.agentGuidance, add only feedback and source proposals permitted by review.agentReviewer.mode, then return the complete artifact with submit --input.',
      'A response-uncertain get-for-review is recovered by repeating get-for-review with only the review ID. A response-uncertain submit is recovered by repeating the exact submit command.'
    ],
    pullRequestStatus: {
      lookup: 'gh pr view <pull-request-url-or-number> --json state,isDraft,url',
      mapping: {
        draft: 'isDraft is true',
        open: 'isDraft is false and state is OPEN',
        merged: 'state is MERGED',
        closed: 'state is CLOSED'
      },
      values: ['draft', 'open', 'merged', 'closed'],
      persistence: 'A successful observation is stored with its receipt time and source agent. A missing --pr-status preserves the last successful observation.',
      failure: 'A failed lookup does not block open, get, get-for-review, or revise. Continue without --pr-status and report the failure. On open, retain --pr and a known canonical --pr-url; when no canonical identity is known, omit the PR association. done requires a verified merged observation.'
    },
    defaultAgentGuidance,
    commands: [
      {
        name: 'open',
        usage: 'open <markdown-path> --summary <text> [--branch <name>] [--pr <number> --pr-url <url> --pr-status <draft|open|merged|closed>] [--thread-id <thread-or-session-id> | --handoff-key <key>] [--thread-host-kind <kind> --thread-host-provider <llm-provider-or-model-family> [--thread-host-thread-id <distinct-host-id>] [--thread-host-machine <hostname>]]',
        purpose: 'Open a durable, non-blocking review and print {reviewId,status,reviewUrl} as JSON.'
      },
      {
        name: 'get',
        usage: 'get <review-id> [--pr-status <draft|open|merged|closed>]',
        purpose: 'Freeze one review and print its complete markover-review JSON.'
      },
      {
        name: 'get-for-review',
        usage: 'get-for-review <review-id> [--pr-status <draft|open|merged|closed>] [--thread-id <provider-id> | --handoff-key <key>] [--thread-host-kind <kind> --thread-host-provider <provider> [--thread-host-thread-id <distinct-id>] [--thread-host-machine <hostname>]]',
        purpose: 'Claim one pristine review for an agent reviewer and print its complete frozen markover-review JSON.'
      },
      {
        name: 'submit',
        usage: 'submit <review-id> --input <path|->',
        purpose: 'Atomically return one complete agent-reviewed markover-review artifact.'
      },
      {
        name: 'revise',
        usage: 'revise <review-id> [--pr-status <draft|open|merged|closed>]',
        purpose: 'Record that the agent acted on every part of a frozen review.'
      },
      {
        name: 'done',
        usage: 'done <pull-request-url> --pr-status merged',
        purpose: 'Mark every local review associated with a verified merged pull request Done.'
      },
      {
        name: 'edit',
        usage: 'edit <review-id>',
        purpose: 'Return a frozen review to editing so the user can add or change feedback.'
      },
      {
        name: 'pending',
        usage: 'pending [--thread-id <provider-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <provider> [--thread-host-thread-id <distinct-id>] [--thread-host-machine <hostname>]',
        purpose: 'List metadata for every unresolved review opened by the exact current requesting thread.'
      },
      {
        name: 'resolve',
        usage: 'resolve <review-id> --outcome <reviewed-no-notes|accepted-unreviewed>',
        purpose: 'Record an explicit manual outcome; feedback requires Markover confirmation before it is abandoned.'
      },
      {
        name: 'unresolve',
        usage: 'unresolve <review-id>',
        purpose: 'Return a reversible manual resolution to Needs me before Done.'
      },
      {
        name: 'canonical',
        usage: 'canonical doctor | canonical refresh [--no-install]',
        purpose: 'Inspect or rebuild the configured canonical instance and reconcile exact markover: ownership from any checkout.'
      },
      {
        name: 'cleanup',
        usage: '--instance dev cleanup <pr-N>',
        purpose: 'Move one stopped worktree-local instance to macOS Trash after its development URL handler has been removed.'
      },
      {
        name: 'help',
        aliases: ['info', '--help', '-h'],
        usage: 'help',
        purpose: 'Print this machine-readable help without starting Markover.'
      }
    ],
    stdout: 'Success writes exactly one JSON value to stdout. Diagnostics use stderr and a non-zero exit status.',
    persistence: 'Canonical reviews use Markover user data; development reviews use the current worktree .markover/instance/reviews directory.'
  }
}

export function formatCommandError(error: unknown): string {
  const lines = [`markover: ${errorMessage(error)}`]
  const usage = error instanceof CommandError ? error.usage : undefined
  if (usage) lines.push(`Usage: ${usage}`)
  lines.push(recoveryHint())
  return `${lines.join('\n')}\n`
}

export function parseCommandArguments(args: string[]): ParsedCommand {
  let instance: InstanceSelector | undefined
  let commandArguments = args
  if (args[0] === '--instance') {
    const value = args[1]
    if (value !== 'canonical' && value !== 'dev') {
      throw commandError(
        '--instance requires canonical or dev.',
        'markover [--instance <canonical|dev>] <command>'
      )
    }
    instance = value === 'dev' ? 'development' : 'canonical'
    commandArguments = args.slice(2)
  }
  if (commandArguments.includes('--instance')) {
    throw commandError(
      '--instance is a global option and must appear before the command.',
      'markover [--instance <canonical|dev>] <command>'
    )
  }

  const targeted = <T extends object>(command: T): T & ParsedInstanceTarget => (
    instance ? { ...command, instance } : command
  )
  const [command, ...rest] = commandArguments
  if (!command || helpAliases.has(command)) {
    if (rest.length) {
      throw commandError(
        `${String(command)} does not accept arguments.`,
        'markover help'
      )
    }
    return targeted({ command: 'help' as const })
  }
  if (
    command === 'canonical'
  ) {
    if (instance) {
      throw commandError(
        'canonical maintenance does not accept --instance.',
        'markover canonical doctor | markover canonical refresh [--no-install]'
      )
    }
    const action = rest[0]
    if (action === 'doctor' && rest.length === 1) {
      return { command, action }
    }
    if (
      action === 'refresh' &&
      (rest.length === 1 || (rest.length === 2 && rest[1] === '--no-install'))
    ) {
      return { command, action, install: rest.length === 1 }
    }
    throw commandError(
      'canonical requires doctor or refresh with only optional --no-install.',
      'markover canonical doctor | markover canonical refresh [--no-install]'
    )
  }
  if (
    command !== 'open' &&
    command !== 'get' &&
    command !== 'get-for-review' &&
    command !== 'submit' &&
    command !== 'revise' &&
    command !== 'done' &&
    command !== 'edit' &&
    command !== 'pending' &&
    command !== 'resolve' &&
    command !== 'unresolve' &&
    command !== 'cleanup'
  ) {
    if (command === 'check') {
      throw commandError(
        'There is no check command. After the user says “Check Markover,” run get with the retained review ID.',
        'markover get <review-id>'
      )
    }
    if (!command.startsWith('-') && /(?:^|[/\\])[^/\\]+\.(?:md|markdown|mdown|mkd)$/i.test(command)) {
      throw commandError(
        `To review ${command}, use the open command and explain the review context.`,
        `markover open ${shellQuote(command)} --summary <text>`
      )
    }
    throw commandError(
      `Unknown command: ${command}`,
      'markover <open|get|get-for-review|submit|revise|done|edit|pending|resolve|unresolve|canonical|cleanup|help> ...'
    )
  }

  if (command === 'cleanup') {
    const expectedIdentity = rest[0]
    if (instance !== 'development') {
      throw commandError(
        'cleanup is available only for the current development worktree.',
        'markover --instance dev cleanup <pr-N>'
      )
    }
    if (
      rest.length !== 1 ||
      expectedIdentity === undefined ||
      !/^pr-[1-9]\d*$/.test(expectedIdentity)
    ) {
      throw commandError(
        'cleanup requires one exact pr-N identity.',
        'markover --instance dev cleanup <pr-N>'
      )
    }
    return targeted({
      command: 'cleanup' as const,
      expectedIdentity: expectedIdentity as `pr-${number}`
    })
  }

  if (command === 'done') {
    const pullRequestUrl = rest[0]
    const option = rest[1]
    const status = rest[2]
    if (
      rest.length !== 3 ||
      !pullRequestUrl ||
      !parseGitHubPullRequestUrl(pullRequestUrl) ||
      option !== '--pr-status' ||
      status !== 'merged'
    ) {
      throw commandError(
        'done requires one canonical GitHub pull request URL and a verified merged status.',
        'markover done <pull-request-url> --pr-status merged'
      )
    }
    return targeted({
      command,
      pullRequestUrl,
      pullRequestStatus: 'merged' as const
    })
  }

  if (command === 'submit') {
    const reviewId = rest[0]
    if (
      rest.length !== 3 ||
      !reviewId ||
      reviewId.startsWith('--') ||
      rest[1] !== '--input' ||
      !rest[2] ||
      rest[2].startsWith('--')
    ) {
      throw commandError(
        'submit requires one review ID and one JSON input path or stdin.',
        'markover submit <review-id> --input <path|->'
      )
    }
    return targeted({ command, reviewId, inputPath: rest[2] })
  }

  if (command === 'resolve') {
    const reviewId = rest[0]
    const outcome = rest[2]
    if (
      rest.length !== 3 ||
      !reviewId ||
      reviewId.startsWith('--') ||
      rest[1] !== '--outcome' ||
      (outcome !== 'reviewed-no-notes' && outcome !== 'accepted-unreviewed')
    ) {
      throw commandError(
        'resolve requires one review ID and an explicit manual outcome.',
        'markover resolve <review-id> --outcome <reviewed-no-notes|accepted-unreviewed>'
      )
    }
    return targeted({ command, reviewId, outcome })
  }

  if (command === 'unresolve') {
    const reviewId = rest[0]
    if (rest.length !== 1 || !reviewId || reviewId.startsWith('--')) {
      throw commandError(
        'unresolve requires exactly one review ID.',
        'markover unresolve <review-id>'
      )
    }
    return targeted({ command, reviewId })
  }

  if (command === 'pending') {
    let handoffKey: string | null = null
    let threadId: string | null = null
    let threadHostKind: string | null = null
    let threadHostProvider: string | null = null
    let threadHostThreadId: string | null = null
    let threadHostMachine: string | null = null
    for (let index = 0; index < rest.length; index += 2) {
      const option = rest[index]
      const value = rest[index + 1]
      if (!option || !value || value.startsWith('--')) {
        throw commandError(
          `${option || 'Pending query option'} requires a value.`,
          'markover pending [current-thread identity options]'
        )
      }
      if (option === '--handoff-key') handoffKey = value
      else if (option === '--thread-id') threadId = value
      else if (option === '--thread-host-kind') threadHostKind = value
      else if (option === '--thread-host-provider') threadHostProvider = value
      else if (option === '--thread-host-thread-id') threadHostThreadId = value
      else if (option === '--thread-host-machine') threadHostMachine = value
      else {
        throw commandError(
          `Unknown option for pending: ${option}`,
          'markover pending [current-thread identity options]'
        )
      }
    }
    handoffKey = handoffKey?.trim() || null
    threadId = threadId?.trim() || null
    threadHostKind = threadHostKind?.trim() || null
    threadHostProvider = threadHostProvider?.trim() || null
    threadHostThreadId = threadHostThreadId?.trim() || null
    threadHostMachine = threadHostMachine?.trim() || null
    if (handoffKey && !HANDOFF_KEY_PATTERN.test(handoffKey)) {
      throw commandError(
        '--handoff-key must match mko_handoff_ followed by 16–64 letters or digits.',
        'markover pending --handoff-key <key> --thread-host-kind <kind> --thread-host-provider <provider>'
      )
    }
    if ((!threadId && !handoffKey) || (threadId && handoffKey)) {
      throw commandError(
        'pending requires exactly one of --thread-id or --handoff-key.',
        'markover pending [--thread-id <provider-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <provider>'
      )
    }
    if (!threadHostKind || !threadHostProvider) {
      throw commandError(
        'pending requires --thread-host-kind and --thread-host-provider.',
        'markover pending [--thread-id <provider-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <provider>'
      )
    }
    return targeted({
      command,
      handoffKey,
      threadId,
      threadHostKind,
      threadHostProvider,
      threadHostThreadId,
      threadHostMachine
    })
  }

  if (command === 'get-for-review') {
    const reviewId = rest[0]
    if (!reviewId || reviewId.startsWith('--')) {
      throw commandError(
        'get-for-review requires one review ID.',
        'markover get-for-review <review-id>'
      )
    }
    let handoffKey: string | null = null
    let pullRequestStatus: PullRequestStatus | null = null
    let threadId: string | null = null
    let threadHostKind: string | null = null
    let threadHostProvider: string | null = null
    let threadHostThreadId: string | null = null
    let threadHostMachine: string | null = null
    for (let index = 1; index < rest.length; index += 2) {
      const option = rest[index]
      const value = rest[index + 1]
      if (!option || !value || value.startsWith('--')) {
        throw commandError(
          `${option || 'Reviewer option'} requires a value.`,
          'markover get-for-review <review-id> [reviewer identity options]'
        )
      }
      if (option === '--handoff-key') handoffKey = value
      else if (option === '--pr-status') {
        if (!isPullRequestStatus(value)) {
          throw commandError(
            '--pr-status requires draft, open, merged, or closed.',
            'markover get-for-review <review-id> [--pr-status <draft|open|merged|closed>]'
          )
        }
        pullRequestStatus = value
      } else if (option === '--thread-id') threadId = value
      else if (option === '--thread-host-kind') threadHostKind = value
      else if (option === '--thread-host-provider') threadHostProvider = value
      else if (option === '--thread-host-thread-id') threadHostThreadId = value
      else if (option === '--thread-host-machine') threadHostMachine = value
      else {
        throw commandError(
          `Unknown option for get-for-review: ${option}`,
          'markover get-for-review <review-id> [reviewer identity options]'
        )
      }
    }
    threadId = threadId?.trim() || null
    threadHostKind = threadHostKind?.trim() || null
    threadHostProvider = threadHostProvider?.trim() || null
    threadHostThreadId = threadHostThreadId?.trim() || null
    threadHostMachine = threadHostMachine?.trim() || null
    handoffKey = handoffKey?.trim() || null
    if (handoffKey && !HANDOFF_KEY_PATTERN.test(handoffKey)) {
      throw commandError(
        '--handoff-key must match mko_handoff_ followed by 16–64 letters or digits.',
        'markover get-for-review <review-id> --handoff-key <key>'
      )
    }
    if (threadId && handoffKey) {
      throw commandError(
        '--thread-id and --handoff-key are alternatives; provide only one.',
        'markover get-for-review <review-id> [--thread-id <provider-id> | --handoff-key <key>]'
      )
    }
    const hasIdentity = Boolean(threadId || handoffKey)
    const hasHostMetadata = Boolean(
      threadHostKind ||
      threadHostProvider ||
      threadHostThreadId ||
      threadHostMachine
    )
    if (hasIdentity && (!threadHostKind || !threadHostProvider)) {
      throw commandError(
        '--thread-id or --handoff-key requires --thread-host-kind and --thread-host-provider.',
        'markover get-for-review <review-id> [--thread-id <provider-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <provider>'
      )
    }
    if (hasHostMetadata && !hasIdentity) {
      throw commandError(
        'Thread-host metadata requires --thread-id or --handoff-key.',
        'markover get-for-review <review-id> [--thread-id <provider-id> | --handoff-key <key>]'
      )
    }
    if (threadId && threadHostThreadId === threadId) {
      throw commandError(
        '--thread-host-thread-id must be omitted when it duplicates --thread-id.',
        'markover get-for-review <review-id> --thread-id <provider-id> --thread-host-kind <kind> --thread-host-provider <provider>'
      )
    }
    return targeted({
      command,
      reviewId,
      handoffKey,
      pullRequestStatus,
      threadId,
      threadHostKind,
      threadHostProvider,
      threadHostThreadId,
      threadHostMachine
    })
  }

  if (command === 'get' || command === 'revise' || command === 'edit') {
    const reviewId = rest[0]
    if (reviewId === undefined || reviewId.startsWith('--')) {
      throw commandError(
        `${command} requires one review ID.`,
        `markover ${command} <review-id>`
      )
    }
    if (command === 'edit') {
      if (rest.length !== 1) {
        throw commandError(
          'edit requires exactly one review ID.',
          'markover edit <review-id>'
        )
      }
      return targeted({ command, reviewId })
    }
    let pullRequestStatus: PullRequestStatus | null = null
    if (rest.length !== 1) {
      if (
        rest.length !== 3 ||
        rest[1] !== '--pr-status' ||
        !isPullRequestStatus(rest[2])
      ) {
        throw commandError(
          `${command} accepts only an optional pull request status.`,
          `markover ${command} <review-id> [--pr-status <draft|open|merged|closed>]`
        )
      }
      pullRequestStatus = rest[2]
    }
    return targeted({ command, reviewId, pullRequestStatus })
  }

  let sourcePath = null
  let contextSummary = null
  let branch = null
  let handoffKey = null
  let pullRequestNumber = null
  let pullRequestUrl = null
  let pullRequestStatus: PullRequestStatus | null = null
  let threadId = null
  let threadHostKind = null
  let threadHostProvider = null
  let threadHostThreadId = null
  let threadHostMachine = null
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === undefined) break
    if (
      argument === '--summary' ||
      argument === '--branch' ||
      argument === '--handoff-key' ||
      argument === '--pr' ||
      argument === '--pr-url' ||
      argument === '--pr-status' ||
      argument === '--thread-id' ||
      argument === '--thread-host-kind' ||
      argument === '--thread-host-provider' ||
      argument === '--thread-host-thread-id' ||
      argument === '--thread-host-machine'
    ) {
      const value = rest[index + 1]
      if (!value || value.startsWith('--')) {
        throw commandError(
          `${argument} requires a value.`,
          'markover open <markdown-path> --summary <text>'
        )
      }
      if (argument === '--summary') contextSummary = value
      if (argument === '--branch') branch = value
      if (argument === '--handoff-key') handoffKey = value
      if (argument === '--thread-id') threadId = value
      if (argument === '--thread-host-kind') threadHostKind = value
      if (argument === '--thread-host-provider') threadHostProvider = value
      if (argument === '--thread-host-thread-id') threadHostThreadId = value
      if (argument === '--thread-host-machine') threadHostMachine = value
      if (argument === '--pr-url') {
        const identity = parseGitHubPullRequestUrl(value)
        if (!identity) {
          throw commandError(
            '--pr-url requires a canonical GitHub pull request URL.',
            'markover open <markdown-path> --summary <text> --pr <number> --pr-url <url> --pr-status <status>'
          )
        }
        pullRequestUrl = identity.url
      }
      if (argument === '--pr-status') {
        if (!isPullRequestStatus(value)) {
          throw commandError(
            '--pr-status requires draft, open, merged, or closed.',
            'markover open <markdown-path> --summary <text> --pr <number> --pr-status <status>'
          )
        }
        pullRequestStatus = value
      }
      if (argument === '--pr') {
        pullRequestNumber = Number(value)
        if (
          !Number.isSafeInteger(pullRequestNumber) ||
          pullRequestNumber < 1
        ) {
          throw commandError(
            '--pr requires a positive integer.',
            'markover open <markdown-path> --summary <text> --pr <number>'
          )
        }
      }
      index += 1
      continue
    }
    if (argument.startsWith('--')) {
      throw commandError(
        `Unknown option for open: ${argument}`,
        'markover open <markdown-path> --summary <text>'
      )
    }
    if (sourcePath) {
      throw commandError(
        'open requires exactly one Markdown path.',
        'markover open <markdown-path> --summary <text>'
      )
    }
    sourcePath = argument
  }

  if (!sourcePath) {
    throw commandError(
      'open requires a Markdown path.',
      'markover open <markdown-path> --summary <text>'
    )
  }
  if (!contextSummary?.trim()) {
    throw commandError(
      'open requires --summary <text>.',
      'markover open <markdown-path> --summary <text>'
    )
  }
  if (branch !== null) {
    branch = branch.trim()
    if (!branch) {
      throw commandError(
        '--branch requires a non-empty value.',
        'markover open <markdown-path> --summary <text> --branch <name>'
      )
    }
  }
  if (threadId !== null) {
    threadId = threadId.trim()
    if (!threadId) {
      throw commandError(
        '--thread-id requires a non-empty value.',
        'markover open <markdown-path> --summary <text> --thread-id <id>'
      )
    }
  }
  for (const [option, value] of [
    ['--thread-host-kind', threadHostKind],
    ['--thread-host-provider', threadHostProvider],
    ['--thread-host-thread-id', threadHostThreadId],
    ['--thread-host-machine', threadHostMachine]
  ] as const) {
    if (value !== null && !value.trim()) {
      throw commandError(
        `${option} requires a non-empty value.`,
        'markover open <markdown-path> --summary <text>'
      )
    }
  }
  threadHostKind = threadHostKind?.trim() || null
  threadHostProvider = threadHostProvider?.trim() || null
  threadHostThreadId = threadHostThreadId?.trim() || null
  threadHostMachine = threadHostMachine?.trim() || null
  if (handoffKey !== null) {
    handoffKey = handoffKey.trim()
    if (!HANDOFF_KEY_PATTERN.test(handoffKey)) {
      throw commandError(
        '--handoff-key must match mko_handoff_ followed by 16–64 letters or digits.',
        'markover open <markdown-path> --summary <text> --handoff-key <key>'
      )
    }
  }
  if (threadId && handoffKey) {
    throw commandError(
      '--thread-id and --handoff-key are alternatives; provide only one.',
      'markover open <markdown-path> --summary <text> [--thread-id <thread-or-session-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <llm-provider-or-model-family>'
    )
  }
  const hasThreadIdentity = Boolean(threadId || handoffKey)
  const hasThreadHostMetadata = Boolean(
    threadHostKind ||
    threadHostProvider ||
    threadHostThreadId ||
    threadHostMachine
  )
  if (hasThreadIdentity && (!threadHostKind || !threadHostProvider)) {
    throw commandError(
      '--thread-id or --handoff-key requires --thread-host-kind and --thread-host-provider.',
      'markover open <markdown-path> --summary <text> [--thread-id <thread-or-session-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <llm-provider-or-model-family>'
    )
  }
  if (hasThreadHostMetadata && !hasThreadIdentity) {
    throw commandError(
      'Thread-host metadata requires --thread-id or --handoff-key.',
      'markover open <markdown-path> --summary <text> [--thread-id <thread-or-session-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <llm-provider-or-model-family>'
    )
  }
  if (pullRequestUrl && !pullRequestNumber) {
    throw commandError(
      '--pr-url requires --pr when opening a review.',
      'markover open <markdown-path> --summary <text> --pr <number> --pr-url <url>'
    )
  }
  if (
    pullRequestUrl &&
    parseGitHubPullRequestUrl(pullRequestUrl)?.number !== pullRequestNumber
  ) {
    throw commandError(
      '--pr-url must identify the pull request number passed with --pr.',
      'markover open <markdown-path> --summary <text> --pr <number> --pr-url <url>'
    )
  }
  if (pullRequestStatus && (!pullRequestNumber || !pullRequestUrl)) {
    throw commandError(
      '--pr-status requires --pr and --pr-url when opening a review.',
      'markover open <markdown-path> --summary <text> --pr <number> --pr-url <url> --pr-status <status>'
    )
  }
  return targeted({
    command,
    sourcePath,
    contextSummary,
    branch,
    handoffKey,
    pullRequestNumber,
    pullRequestUrl,
    pullRequestStatus,
    threadId,
    threadHostKind,
    threadHostProvider,
    threadHostThreadId,
    threadHostMachine
  })
}

export function checksum(source: string): string {
  return `sha256:${crypto.createHash('sha256').update(source, 'utf8').digest('hex')}`
}

const remoteAuthorCommands = new Set<ParsedCommand['command']>([
  'open',
  'pending',
  'get',
  'edit',
  'revise',
  'done'
])

function remoteProfileApplies(parsed: ParsedCommand): boolean {
  return parsed.instance === undefined &&
    remoteAuthorCommands.has(parsed.command)
}

function defaultRemoteJournalRoot(): string {
  return path.join(os.homedir(), '.markover', 'remote-client', 'creation-journal')
}

function remoteOpenReceipt(
  response: unknown,
  requestDigest: string
): RemoteCreationReceipt {
  if (
    response === null ||
    typeof response !== 'object' ||
    Array.isArray(response) ||
    typeof Reflect.get(response, 'reviewId') !== 'string' ||
    Reflect.get(response, 'status') !== 'editing' ||
    typeof Reflect.get(response, 'reviewUrl') !== 'string'
  ) {
    throw new RemoteClientError(
      'INCOMPATIBLE_REMOTE_CANONICAL',
      'Canonical Markover returned an invalid remote creation receipt.'
    )
  }
  return {
    reviewId: Reflect.get(response, 'reviewId') as string,
    status: 'editing',
    reviewUrl: Reflect.get(response, 'reviewUrl') as string,
    requestDigest
  }
}

function conflictRequestDigest(error: unknown): string | null {
  if (!(error instanceof RemoteClientError) || error.code !== 'IDEMPOTENCY_CONFLICT') {
    return null
  }
  const receipt = error.details?.creationReceipt
  if (
    receipt === null ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt)
  ) return null
  const digest = (receipt as Record<string, unknown>).requestDigest
  return typeof digest === 'string' ? digest : null
}

function remoteCreateHeaders(
  entry: RemoteCreationEntry,
  requestDigest: string
): Record<string, string> {
  return {
    [REMOTE_GATEWAY_IDEMPOTENCY_HEADER]: entry.idempotencyKey,
    [REMOTE_GATEWAY_REQUEST_DIGEST_HEADER]: requestDigest
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export interface ResolveMarkoverAppOptions {
  environment?: NodeJS.ProcessEnv
  exists?: (candidate: string) => boolean
  homeDirectory?: string
}

export function resolveMarkoverApp({
  environment = process.env,
  exists = fsSync.existsSync,
  homeDirectory = os.homedir()
}: ResolveMarkoverAppOptions = {}): string | null {
  const candidates = [
    environment.MARKOVER_APP_PATH,
    path.join(homeDirectory, 'Applications', 'Markover.app'),
    '/Applications/Markover.app'
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find((candidate) => exists(candidate)) || null
}

export function startDetachedApp(
  options: ResolveMarkoverAppOptions = {}
): void {
  if (process.platform !== 'darwin') {
    throw new Error('Automatic Markover startup currently requires macOS.')
  }

  const packagedApp = resolveMarkoverApp(options)
  if (!packagedApp) {
    throw new Error('The canonical Markover application is not installed.')
  }
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const result = spawnSync(
    '/usr/bin/open',
    [
      '-g',
      '-j',
      '-n',
      packagedApp,
      '--args',
      '--markover-server'
    ],
    { encoding: 'utf8', env: environment }
  )
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `open exited ${String(result.status)}`)
  }
}

export interface StartDetachedInstanceOptions extends ResolveMarkoverAppOptions {
  platform?: NodeJS.Platform
  spawnProcess?: typeof spawn
}

export function startDetachedInstance(
  instance: ResolvedInstance,
  {
    platform = process.platform,
    spawnProcess = spawn,
    ...appOptions
  }: StartDetachedInstanceOptions = {}
): void {
  if (platform !== 'darwin') {
    throw new Error('Automatic Markover startup currently requires macOS.')
  }
  if (instance.identity.kind === 'canonical' && !instance.checkout) {
    const packagedApp = resolveMarkoverApp(appOptions)
    if (packagedApp) {
      startDetachedApp({
        ...appOptions,
        exists: (candidate) => candidate === packagedApp
      })
      return
    }
  }
  if (
    instance.process.status !== 'stopped' ||
    !instance.coldStart.eligible ||
    !instance.checkout
  ) {
    throw new Error(
      `Cannot cold-start ${instance.identity.key}: ${instance.coldStart.blockedBy || 'checkout unavailable'}.`
    )
  }
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const selector = instance.identity.kind === 'development'
    ? 'dev'
    : 'canonical'
  const child = spawnProcess(
    'npm',
    ['start', '--', '--instance', selector, '--markover-server'],
    {
      cwd: instance.checkout,
      detached: true,
      env: environment,
      stdio: 'ignore'
    }
  )
  child.unref()
}

async function waitForService(
  endpointPath: string,
  deadline: number
): Promise<void> {
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      await probeService(endpointPath)
      return
    } catch (error) {
      lastError = error
      await delay(100)
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('Markover service startup timed out.')
}

export interface EnsureServiceOptions {
  endpointPath?: string
  startApp?: () => void
  timeoutMilliseconds?: number
}

export async function ensureService({
  endpointPath = defaultEndpointPath,
  startApp = startDetachedApp,
  timeoutMilliseconds = 30_000
}: EnsureServiceOptions = {}): Promise<void> {
  try {
    await probeService(endpointPath)
    return
  } catch {
    startApp()
  }

  const startedAt = Date.now()
  try {
    await waitForService(endpointPath, startedAt + timeoutMilliseconds)
  } catch (error) {
    const diagnosticPath = path.join(
      path.dirname(endpointPath),
      'startup-diagnostic.json'
    )
    throw new LocalServiceError(
      'SERVICE_STARTUP_TIMEOUT',
      `Markover did not become ready: ${errorMessage(error)} Inspect ${diagnosticPath}; the app remains available to inspect or quit.`
    )
  }
}

export interface ExecuteCommandOptions {
  endpointPath?: string
  ensure?: () => Promise<void>
  resolveTarget?: (
    selector: InstanceSelector,
    expectedPullRequestNumber?: number
  ) => Promise<ResolvedInstance>
  cleanup?: (
    instance: ResolvedInstance,
    expectedIdentity: string
  ) => Promise<CleanupDevelopmentInstanceResult>
  discoverMetadata?: (
    input: ReviewMetadataInput
  ) => Promise<ReviewMetadata>
  readSessionDiscoverySetting?: (settingsPath: string) => Promise<boolean>
  settingsPath?: string
  doctorCanonical?: () => Promise<CanonicalDoctorResult>
  refreshCanonical?: (install: boolean) => Promise<CanonicalRefreshResult>
  verifyCanonicalRouting?: (instance: ResolvedInstance) => Promise<void>
  loadRemoteProfile?: () => Promise<RemoteProfile | null>
  readRemoteHealth?: (profile: RemoteProfile) => Promise<RemoteHealth>
  requestRemote?: (
    profile: RemoteProfile,
    method: string,
    requestPath: string,
    body?: unknown,
    options?: RemoteJsonRequestOptions
  ) => Promise<unknown>
  remoteJournal?: RemoteCreationJournal
  remoteJournalRoot?: string
}

export interface CanonicalRefreshResult {
  format: 'markover-canonical-refresh'
  version: 1
  status: 'healthy'
  checkout: string
  application: {
    mode: 'installed' | 'generated'
    appPath: string
    executablePath: string
  }
  handler: LinkHandlerMutationResult
  doctor: CanonicalDoctorResult
}

export interface RefreshCanonicalOptions {
  build?: (
    instance: ResolvedInstance
  ) => Promise<AddressedDevelopmentBundle>
  checkoutIsClean?: (checkout: string) => boolean
  doctor?: (instance: ResolvedInstance) => Promise<CanonicalDoctorResult>
  install?: boolean
  isProcessAlive?: (pid: number) => boolean
  launch?: (
    instance: ResolvedInstance,
    executablePath: string
  ) => Promise<number | undefined>
  now?: () => number
  prepareInstallation?: (
    bundle: AddressedDevelopmentBundle
  ) => Promise<CanonicalApplicationTransaction>
  quit?: (endpointPath: string) => Promise<void>
  readProcessPid?: (endpointPath: string) => Promise<number>
  replaceHandler?: (
    instance: ResolvedInstance
  ) => Promise<LinkHandlerMutationResult>
  resolve?: () => Promise<ResolvedInstance>
  timeoutMilliseconds?: number
  terminateProcess?: (pid: number) => void
  wait?: (milliseconds: number) => Promise<void>
}

function commandFailure(result: ReturnType<typeof spawnSync>): string {
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  return result.error?.message || stderr || stdout ||
    `command exited ${String(result.status ?? 1)}`
}

function buildCanonicalCheckout(
  instance: ResolvedInstance
): Promise<AddressedDevelopmentBundle> {
  if (!instance.checkout) throw new Error('Canonical checkout is unavailable.')
  const result = spawnSync('npm', ['run', 'build', '--silent'], {
    cwd: instance.checkout,
    encoding: 'utf8'
  })
  if (result.error || result.status !== 0) {
    throw new Error(`Canonical build failed: ${commandFailure(result)}`)
  }
  const bundleResult = spawnSync(
    process.execPath,
    [path.join(instance.checkout, 'build', 'scripts', 'build-canonical-bundle.js')],
    { cwd: instance.checkout, encoding: 'utf8' }
  )
  if (bundleResult.error || bundleResult.status !== 0) {
    throw new Error(
      `Canonical bundle build failed: ${commandFailure(bundleResult)}`
    )
  }
  const expected = addressedDevelopmentBundle(instance)
  let built: unknown
  try {
    built = JSON.parse(
      typeof bundleResult.stdout === 'string' ? bundleResult.stdout : ''
    ) as unknown
  } catch (error) {
    throw new Error('Canonical bundle build returned invalid JSON.', {
      cause: error
    })
  }
  if (
    typeof built !== 'object' ||
    built === null ||
    Object.entries(expected).some(
      ([key, value]) =>
        (built as Record<string, unknown>)[key] !== value
    )
  ) {
    throw new Error(
      'Canonical bundle build returned an unexpected application address.'
    )
  }
  return Promise.resolve(expected)
}

function canonicalCheckoutIsClean(checkout: string): boolean {
  const result = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: checkout, encoding: 'utf8' }
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      `Cannot inspect canonical checkout cleanliness: ${commandFailure(result)}`
    )
  }
  return typeof result.stdout === 'string' && result.stdout.trim() === ''
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) !== 'ESRCH'
  }
}

function terminateProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error
  }
}

export function launchCanonicalApplication(
  instance: ResolvedInstance,
  executablePath: string,
  spawnProcess: typeof spawn = spawn
): Promise<number> {
  if (!instance.checkout) throw new Error('Canonical checkout is unavailable.')
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    [RESOLVED_INSTANCE_ENVIRONMENT]: resolvedInstanceEnvironment(instance)
  }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawnProcess(
    executablePath,
    [
      '--markover-server',
      '--markover-refresh-window'
    ],
    {
      cwd: instance.checkout,
      detached: true,
      env: environment,
      stdio: 'ignore'
    }
  )
  return new Promise<number>((resolve, reject) => {
    let launched = false
    child.once('error', (error) => {
      if (!launched) {
        reject(error)
        return
      }
      process.stderr.write(
        `markover canonical process error: ${errorMessage(error)}\n`
      )
    })
    child.once('spawn', () => {
      launched = true
      if (child.pid === undefined) {
        reject(new Error('Canonical application launched without a process ID.'))
        return
      }
      child.unref()
      resolve(child.pid)
    })
  })
}

function sameCanonicalCheckout(
  expected: ResolvedInstance,
  current: ResolvedInstance
): boolean {
  return expected.identity.kind === 'canonical' &&
    current.identity.kind === 'canonical' &&
    expected.checkout !== null &&
    current.checkout !== null &&
    path.resolve(expected.checkout) === path.resolve(current.checkout)
}

export async function refreshCanonicalInstance({
  build = buildCanonicalCheckout,
  checkoutIsClean = canonicalCheckoutIsClean,
  doctor = (instance) => inspectCanonicalHealth(instance),
  install = true,
  isProcessAlive = processIsAlive,
  launch = launchCanonicalApplication,
  now = Date.now,
  prepareInstallation = stageCanonicalApplication,
  quit = requestServiceQuit,
  readProcessPid = async (endpointPath) => (
    await readEndpoint(endpointPath)
  ).pid,
  replaceHandler = (instance) => installLinkHandler(
    'replace',
    instance,
    instance.checkout
      ? {
          sourcePath: path.join(
            instance.checkout,
            'native/MarkoverLinkHandler.swift'
          )
        }
      : {}
  ),
  resolve = () => resolveInstance('canonical'),
  timeoutMilliseconds = 30_000,
  terminateProcess: terminate = terminateProcess,
  wait = delay
}: RefreshCanonicalOptions = {}): Promise<CanonicalRefreshResult> {
  const initial = await resolve()
  if (!initial.checkout || (
    initial.coldStart.blockedBy !== null &&
    initial.coldStart.blockedBy !== 'already-running'
  )) {
    throw new Error(
      `Cannot refresh canonical: ${initial.coldStart.blockedBy || 'checkout unavailable'}.`
    )
  }
  if (!checkoutIsClean(initial.checkout)) {
    throw new Error(
      `Cannot refresh canonical: the configured checkout is dirty (${initial.checkout}).`
    )
  }
  const bundle = await build(initial)
  const address = canonicalApplicationAddress(initial)
  if (
    bundle.identityKey !== 'canonical' ||
    bundle.appBundleId !== address.bundleIdentifier ||
    path.resolve(bundle.appPath) !== path.resolve(address.generatedAppPath)
  ) {
    throw new Error('Canonical build returned an unexpected addressed bundle.')
  }
  const installation = install
    ? await prepareInstallation(bundle)
    : null
  const appPath = install
    ? address.installedAppPath
    : address.generatedAppPath
  const executablePath = install
    ? address.installedExecutablePath
    : address.generatedExecutablePath
  const deadline = now() + timeoutMilliseconds
  let replacementActive = false
  let replacementPid: number | null = null
  try {
    const previousPid = initial.process.status === 'running'
      ? await readProcessPid(initial.service.endpointPath)
      : null
    if (initial.process.status === 'running') {
      await quit(initial.service.endpointPath)
    }
    let stopped = initial
    while ((
      stopped.process.status !== 'stopped' ||
      (previousPid !== null && isProcessAlive(previousPid))
    ) && now() < deadline) {
      await wait(100)
      stopped = await resolve()
      if (!sameCanonicalCheckout(initial, stopped)) {
        throw new Error('Canonical checkout identity changed during refresh.')
      }
    }
    if (stopped.process.status !== 'stopped') {
      throw new Error('Timed out waiting for canonical shutdown.')
    }
    if (previousPid !== null && isProcessAlive(previousPid)) {
      throw new Error(
        `Timed out waiting for canonical process ${String(previousPid)} to release its single-instance lock.`
      )
    }
    if (!stopped.coldStart.eligible) {
      stopped = {
        ...stopped,
        coldStart: stopped.coldStart.blockedBy === 'already-running'
          ? { eligible: true, blockedBy: null }
          : stopped.coldStart
      }
    }
    if (!stopped.coldStart.eligible) {
      throw new Error(
        `Cannot relaunch canonical: ${stopped.coldStart.blockedBy || 'not eligible'}.`
      )
    }
    if (installation) {
      await installation.replace()
      replacementActive = true
    }
    replacementPid = await launch(stopped, executablePath) ?? null
    let running = stopped
    while (running.process.status !== 'running' && now() < deadline) {
      await wait(100)
      running = await resolve()
      if (!sameCanonicalCheckout(initial, running)) {
        throw new Error('Canonical checkout identity changed during relaunch.')
      }
    }
    if (running.process.status !== 'running') {
      throw new Error('Timed out waiting for canonical readiness.')
    }
    const handler = await replaceHandler(running)
    let health = await doctor(running)
    while ((
      health.status !== 'healthy' ||
      health.window.status !== 'electron-visible' ||
      health.application.status !== 'current' ||
      health.application.executablePath !== executablePath
    ) && now() < deadline) {
      await wait(100)
      health = await doctor(running)
    }
    if (health.status !== 'healthy') {
      throw new Error(
        `Canonical refresh completed but doctor remains unhealthy: ${health.issues.join(' ')}`
      )
    }
    if (health.window.status !== 'electron-visible') {
      throw new Error(
        `Canonical refresh completed but its window is ${health.window.status}.`
      )
    }
    if (
      health.application.status !== 'current' ||
      health.application.executablePath !== executablePath
    ) {
      throw new Error(
        `Canonical refresh launched ${health.application.executablePath || 'an unknown executable'} instead of ${executablePath}.`
      )
    }
    if (installation) await installation.commit()
    return {
      format: 'markover-canonical-refresh',
      version: 1,
      status: 'healthy',
      checkout: initial.checkout,
      application: {
        mode: install ? 'installed' : 'generated',
        appPath,
        executablePath
      },
      handler,
      doctor: health
    }
  } catch (error) {
    if (installation) {
      try {
        if (replacementActive) {
          if (replacementPid !== null && isProcessAlive(replacementPid)) {
            try {
              await quit(initial.service.endpointPath)
            } catch (quitError) {
              try {
                terminate(replacementPid)
              } catch (terminationError) {
                throw new AggregateError(
                  [quitError, terminationError],
                  `Could not stop replacement process ${String(replacementPid)} before rollback.`,
                  { cause: terminationError }
                )
              }
            }
            const rollbackDeadline = now() + timeoutMilliseconds
            while (
              isProcessAlive(replacementPid) &&
              now() < rollbackDeadline
            ) {
              await wait(100)
            }
            if (isProcessAlive(replacementPid)) {
              throw new Error(
                `Timed out waiting for replacement process ${String(replacementPid)} before rollback.`,
                { cause: error }
              )
            }
          }
          await installation.rollback()
        } else {
          await installation.discard()
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `${errorMessage(error)} Canonical application recovery also failed: ${errorMessage(rollbackError)}`,
          { cause: rollbackError }
        )
      }
    }
    throw error
  }
}

export async function readSessionDiscoverySetting(
  settingsPath: string
): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    return normalizeSettings(value)
      .discoverAgentThreadFromLocalSessions
  } catch (error) {
    return errorCode(error) === 'ENOENT'
  }
}

export async function executeCommand(
  parsed: ParsedCommand,
  options: ExecuteCommandOptions = {}
): Promise<unknown> {
  if (parsed.command === 'help') return helpPayload()
  if (parsed.command === 'canonical') {
    if (parsed.action === 'doctor') {
      return (options.doctorCanonical || inspectCanonicalHealth)()
    }
    return options.refreshCanonical
      ? options.refreshCanonical(parsed.install)
      : refreshCanonicalInstance({ install: parsed.install })
  }

  const selector = parsed.instance || 'canonical'
  const resolveTarget = options.resolveTarget || (
    (target, expectedPullRequestNumber) => resolveInstance(target, {
      ...(expectedPullRequestNumber === undefined
        ? {}
        : { expectedPullRequestNumber })
    })
  )
  if (parsed.command === 'cleanup') {
    const pullRequestNumber = Number(parsed.expectedIdentity.slice(3))
    const instance = options.resolveTarget
      ? await resolveTarget('development', pullRequestNumber)
      : await resolveInstance('development', {
          expectedPullRequestNumber: pullRequestNumber,
          operation: 'cleanup'
        })
    const cleanup = options.cleanup || cleanupDevelopmentInstance
    return cleanup(instance, parsed.expectedIdentity)
  }

  const profile = parsed.instance === undefined
    ? await (options.loadRemoteProfile || loadRemoteProfile)()
    : null
  if (profile && !remoteProfileApplies(parsed)) {
    throw commandError(
      `${parsed.command} is not available through the remote author profile.`,
      'markover <open|pending|get|edit|revise|done> ...'
    )
  }
  const remoteHealth = profile
    ? await (options.readRemoteHealth || readRemoteHealth)(profile)
    : null
  const remoteRequest = options.requestRemote || requestRemoteJson
  const instance = profile || options.endpointPath
    ? null
    : await resolveTarget(selector)
  const endpointPath = options.endpointPath || instance?.service.endpointPath ||
    defaultEndpointPath
  const ensure = options.ensure || (() => ensureService({
    endpointPath,
    startApp: instance
      ? () => {
          startDetachedInstance(instance)
        }
      : startDetachedApp
  }))
  const {
    discoverMetadata = discoverReviewMetadata,
    readSessionDiscoverySetting: readDiscoverySetting = readSessionDiscoverySetting,
    settingsPath = path.join(path.dirname(endpointPath), 'settings.json')
  } = options
  const requestAuthorJson = (
    method: string,
    requestPath: string,
    body?: unknown,
    requestOptions: {
      headers?: Readonly<Record<string, string>>
      mutation?: boolean
      timeoutMilliseconds?: number
    } = {}
  ): Promise<unknown> => profile
    ? remoteRequest(profile, method, requestPath, body ?? null, {
        ...(requestOptions.headers
          ? { headers: requestOptions.headers }
          : {}),
        ...(requestOptions.mutation === undefined
          ? {}
          : { mutation: requestOptions.mutation }),
        preflight: false
      })
    : requestJson(
        endpointPath,
        method,
        requestPath,
        body,
        requestOptions.timeoutMilliseconds === undefined
          ? undefined
          : { timeoutMilliseconds: requestOptions.timeoutMilliseconds }
      )
  if (parsed.command === 'open') {
    const sourcePath = path.resolve(parsed.sourcePath)
    const journal = profile
      ? options.remoteJournal || new RemoteCreationJournal(
          options.remoteJournalRoot || defaultRemoteJournalRoot()
        )
      : null
    let journalEntry: RemoteCreationEntry | null = null
    const finishRemoteOpen = async (
      response: unknown,
      requestDigest: string
    ): Promise<{ reviewId: string; status: string; reviewUrl: string }> => {
      const receipt = remoteOpenReceipt(response, requestDigest)
      await (journal as RemoteCreationJournal).complete(
        journalEntry as RemoteCreationEntry,
        receipt
      )
      return {
        reviewId: receipt.reviewId,
        status: receipt.status,
        reviewUrl: receipt.reviewUrl
      }
    }
    const recoverRemoteOpen = async (
      requestDigest: string
    ): Promise<{ reviewId: string; status: string; reviewUrl: string }> => {
      try {
        const response = await requestAuthorJson('POST', '/reviews', undefined, {
          headers: remoteCreateHeaders(
            journalEntry as RemoteCreationEntry,
            requestDigest
          ),
          mutation: true
        })
        return await finishRemoteOpen(response, requestDigest)
      } catch (error) {
        const committedDigest = conflictRequestDigest(error)
        if (
          committedDigest &&
          (journalEntry as RemoteCreationEntry).requestDigests.includes(
            committedDigest
          )
        ) {
          const response = await requestAuthorJson(
            'POST',
            '/reviews',
            undefined,
            {
              headers: remoteCreateHeaders(
                journalEntry as RemoteCreationEntry,
                committedDigest
              ),
              mutation: true
            }
          )
          return finishRemoteOpen(response, committedDigest)
        }
        throw error
      }
    }
    if (profile && journal) {
      const acquired = await journal.acquire({
        profileId: checksum(profile.baseUrl),
        sourcePath,
        contextSummary: parsed.contextSummary,
        branch: parsed.branch ?? null,
        handoffKey: parsed.handoffKey ?? null,
        pullRequestNumber: parsed.pullRequestNumber ?? null,
        pullRequestUrl: parsed.pullRequestUrl ?? null,
        threadId: parsed.threadId ?? null,
        threadHostKind: parsed.threadHostKind ?? null,
        threadHostProvider: parsed.threadHostProvider ?? null,
        threadHostThreadId: parsed.threadHostThreadId ?? null,
        threadHostMachine: parsed.threadHostMachine ?? null
      })
      journalEntry = acquired.entry
      const recoveryDigest = journalEntry.requestDigests.at(-1)
      if (acquired.inProgress && !recoveryDigest) {
        throw new RemoteCreationJournalError(
          'REMOTE_OPEN_IN_PROGRESS',
          'An identical remote open is already discovering metadata. Retry after that invocation finishes.'
        )
      }
      if (acquired.resumed && recoveryDigest) {
        try {
          return await recoverRemoteOpen(recoveryDigest)
        } catch (error) {
          if (!(error instanceof RemoteClientError) || error.code !== 'RECEIPT_NOT_FOUND') {
            throw error
          }
        }
      }
    }
    let stats
    try {
      stats = await fs.stat(sourcePath)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw commandError(
          `Markdown file does not exist: ${sourcePath}`,
          'markover open <markdown-path> --summary <text>'
        )
      }
      throw error
    }
    if (!stats.isFile()) throw new Error(`Not a file: ${sourcePath}`)
    const source = await fs.readFile(sourcePath, 'utf8')
    const tree = parseMarkdown(source, checksum(source), {
      name: path.basename(sourcePath),
      path: sourcePath
    })
    const discoveryEnabled = remoteHealth
      ? remoteHealth.discoverAgentThreadFromLocalSessions
      : parsed.handoffKey && !parsed.threadId
        ? await readDiscoverySetting(settingsPath)
        : true
    const handoffKey = parsed.handoffKey && !parsed.threadId &&
      !discoveryEnabled
      ? null
      : parsed.handoffKey ?? null
    const metadata = await discoverMetadata({
      sourcePath,
      branch: parsed.branch ?? null,
      pullRequestNumber: parsed.pullRequestNumber ?? null,
      pullRequestUrl: parsed.pullRequestUrl ?? null,
      threadId: parsed.threadId ?? null,
      threadHostKind: parsed.threadHostKind ?? null,
      threadHostProvider: parsed.threadHostProvider ?? null,
      threadHostThreadId: parsed.threadHostThreadId ?? null,
      threadHostMachine: parsed.threadHostMachine ?? null,
      handoffKey
    })
    if (profile && journal && journalEntry) {
      const body = {
        tree,
        pullRequestStatus: parsed.pullRequestStatus,
        metadata: {
          contextSummary: parsed.contextSummary,
          ...metadata
        }
      }
      const requestBytes = JSON.stringify(body)
      if (Buffer.byteLength(requestBytes, 'utf8') > MAXIMUM_BODY_BYTES) {
        throw commandError(
          'Remote review creation exceeds Markover’s 16 MiB request limit.',
          'markover open <markdown-path> --summary <text>'
        )
      }
      const requestDigest = checksum(requestBytes)
      journalEntry = await journal.appendRequestDigest(
        journalEntry,
        requestDigest
      )
      try {
        const response = await requestAuthorJson('POST', '/reviews', body, {
          headers: remoteCreateHeaders(journalEntry, requestDigest),
          mutation: true
        })
        return await finishRemoteOpen(response, requestDigest)
      } catch (error) {
        const committedDigest = conflictRequestDigest(error)
        if (committedDigest && journalEntry.requestDigests.includes(committedDigest)) {
          return recoverRemoteOpen(committedDigest)
        }
        throw error
      }
    }
    await ensure()
    if (instance) {
      await (options.verifyCanonicalRouting ||
        assertCanonicalReviewRoutingReady)(instance)
    }
    const opened = await requestAuthorJson('POST', '/reviews', {
      tree,
      pullRequestStatus: parsed.pullRequestStatus,
      metadata: {
        contextSummary: parsed.contextSummary,
        ...metadata
      }
    })
    if (
      !opened ||
      typeof opened !== 'object' ||
      Array.isArray(opened) ||
      typeof Reflect.get(opened, 'reviewId') !== 'string' ||
      Reflect.get(opened, 'status') !== 'editing'
    ) {
      throw new LocalServiceError(
        'INCOMPATIBLE_SERVICE',
        'Markover returned an invalid review creation response.'
      )
    }
    const reviewId = Reflect.get(opened, 'reviewId') as string
    const status = Reflect.get(opened, 'status') as 'editing'
    return {
      reviewId,
      status,
      reviewUrl: reviewUrl(
        instance?.scheme || CANONICAL_INSTANCE_SCHEME,
        reviewId
      )
    }
  }

  if (!profile) await ensure()
  if (parsed.command === 'pending') {
    let agentThread: ReviewAgentThread | null
    if (parsed.threadId) {
      agentThread = {
        id: parsed.threadId,
        threadHost: {
          kind: parsed.threadHostKind,
          provider: parsed.threadHostProvider,
          ...(parsed.threadHostThreadId
            ? { threadId: parsed.threadHostThreadId }
            : {}),
          ...(parsed.threadHostMachine
            ? { machine: parsed.threadHostMachine }
            : {})
        }
      }
    } else {
      const discoveryEnabled = remoteHealth
        ? remoteHealth.discoverAgentThreadFromLocalSessions
        : await readDiscoverySetting(settingsPath)
      if (!discoveryEnabled) {
        throw commandError(
          'Handoff-key discovery is disabled; use an explicit --thread-id.',
          'markover pending --thread-id <provider-id> --thread-host-kind <kind> --thread-host-provider <provider>'
        )
      }
      agentThread = (await discoverMetadata({
        sourcePath: path.join(process.cwd(), '.markover-pending-query'),
        threadId: null,
        threadHostKind: parsed.threadHostKind,
        threadHostProvider: parsed.threadHostProvider,
        threadHostThreadId: parsed.threadHostThreadId ?? null,
        threadHostMachine: parsed.threadHostMachine ?? null,
        handoffKey: parsed.handoffKey ?? null
      })).agentThread
      if (!agentThread) {
        throw commandError(
          'The current requesting thread could not be resolved from the handoff key.',
          'markover pending [--thread-id <provider-id> | --handoff-key <key>] --thread-host-kind <kind> --thread-host-provider <provider>'
        )
      }
    }
    const response = await requestAuthorJson(
      'POST',
      '/reviews/pending',
      { agentThread }
    )
    if (
      !response ||
      typeof response !== 'object' ||
      Array.isArray(response) ||
      Reflect.get(response, 'format') !== 'markover-pending-reviews' ||
      Reflect.get(response, 'version') !== 1 ||
      !Array.isArray(Reflect.get(response, 'reviews'))
    ) {
      throw new LocalServiceError(
        'INCOMPATIBLE_SERVICE',
        'Markover returned an invalid pending-review response.'
      )
    }
    const reviews = Reflect.get(response, 'reviews') as unknown[]
    return {
      format: 'markover-pending-reviews',
      version: 1,
      reviews: reviews.map((review) => {
        if (
          !review ||
          typeof review !== 'object' ||
          Array.isArray(review) ||
          typeof Reflect.get(review, 'reviewId') !== 'string'
        ) {
          throw new LocalServiceError(
            'INCOMPATIBLE_SERVICE',
            'Markover returned an invalid pending-review item.'
          )
        }
        const reviewId = Reflect.get(review, 'reviewId') as string
        if (profile) {
          if (typeof Reflect.get(review, 'reviewUrl') !== 'string') {
            throw new RemoteClientError(
              'INCOMPATIBLE_REMOTE_CANONICAL',
              'Canonical Markover returned a pending review without its canonical URL.'
            )
          }
          return review
        }
        return {
          ...review,
          reviewUrl: reviewUrl(
            instance?.scheme || CANONICAL_INSTANCE_SCHEME,
            reviewId
          )
        }
      })
    }
  }
  if (parsed.command === 'resolve') {
    return requestJson(
      endpointPath,
      'POST',
      `/reviews/${encodeURIComponent(parsed.reviewId)}/resolve`,
      { outcome: parsed.outcome },
      { timeoutMilliseconds: 5 * 60 * 1000 }
    )
  }
  if (parsed.command === 'unresolve') {
    return requestJson(
      endpointPath,
      'POST',
      `/reviews/${encodeURIComponent(parsed.reviewId)}/unresolve`
    )
  }
  if (parsed.command === 'submit') {
    let contents: string
    try {
      contents = parsed.inputPath === '-'
        ? await fs.readFile('/dev/stdin', 'utf8')
        : await fs.readFile(path.resolve(parsed.inputPath), 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw commandError(
          `Submission file does not exist: ${path.resolve(parsed.inputPath)}`,
          'markover submit <review-id> --input <path|->'
        )
      }
      throw error
    }
    let artifact: ReviewArtifact
    try {
      artifact = decodeReviewArtifact(JSON.parse(contents), parsed.reviewId)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw commandError(
          'Submission input must contain one valid JSON artifact.',
          'markover submit <review-id> --input <path|->'
        )
      }
      if (error instanceof ReviewFormatError) {
        throw new LocalServiceError(error.code, error.message)
      }
      throw error
    }
    const body = { artifact }
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAXIMUM_BODY_BYTES) {
      throw commandError(
        'Submission exceeds Markover’s 16 MiB request limit. Shrink the annotations and retry, or ask the human to cancel with edit.',
        'markover submit <review-id> --input <path|->'
      )
    }
    const result = await requestJson(
      endpointPath,
      'POST',
      `/reviews/${encodeURIComponent(parsed.reviewId)}/submit`,
      body
    )
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      Reflect.get(result, 'reviewId') !== parsed.reviewId ||
      Reflect.get(result, 'status') !== 'reviewed'
    ) {
      throw new LocalServiceError(
        'INCOMPATIBLE_SERVICE',
        'Markover returned an invalid agent-review submission receipt.'
      )
    }
    return result
  }
  if (parsed.command === 'get-for-review') {
    const encodedReviewId = encodeURIComponent(parsed.reviewId)
    let current: ReviewArtifact
    try {
      current = decodeReviewArtifact(
        await requestJson(endpointPath, 'GET', `/reviews/${encodedReviewId}`),
        parsed.reviewId
      )
    } catch (error) {
      if (error instanceof ReviewFormatError) {
        throw new LocalServiceError(error.code, error.message)
      }
      throw error
    }

    let agentThread: ReviewAgentThread | null | undefined
    if (parsed.threadId) {
      agentThread = {
        id: parsed.threadId,
        threadHost: {
          kind: parsed.threadHostKind as string,
          provider: parsed.threadHostProvider as string,
          ...(parsed.threadHostThreadId
            ? { threadId: parsed.threadHostThreadId }
            : {}),
          ...(parsed.threadHostMachine
            ? { machine: parsed.threadHostMachine }
            : {})
        }
      }
    } else if (parsed.handoffKey) {
      if (current.review.status === 'agent-reviewing') {
        throw commandError(
          'A claimed review never re-runs handoff-key discovery. Retry get-for-review with only the review ID.',
          'markover get-for-review <review-id>'
        )
      }
      const discoveryEnabled = await readDiscoverySetting(settingsPath)
      if (!discoveryEnabled) {
        agentThread = null
      } else {
        const sourcePath = current.sourceDocument.path
        if (!sourcePath) {
          throw commandError(
            'Handoff-key discovery requires a verified live source path; use explicit --thread-id metadata or omit reviewer identity.',
            'markover get-for-review <review-id> [--thread-id <provider-id>]'
          )
        }
        let source: string
        try {
          source = await fs.readFile(sourcePath, 'utf8')
        } catch {
          throw commandError(
            'Handoff-key discovery requires the stored source path to exist and match the review snapshot.',
            'markover get-for-review <review-id> [--thread-id <provider-id>]'
          )
        }
        if (checksum(source) !== current.sourceDocument.checksum) {
          throw commandError(
            'Handoff-key discovery requires the stored source path to match the review snapshot.',
            'markover get-for-review <review-id> [--thread-id <provider-id>]'
          )
        }
        agentThread = (await discoverMetadata({
          sourcePath,
          threadId: null,
          threadHostKind: parsed.threadHostKind ?? null,
          threadHostProvider: parsed.threadHostProvider ?? null,
          threadHostThreadId: parsed.threadHostThreadId ?? null,
          threadHostMachine: parsed.threadHostMachine ?? null,
          handoffKey: parsed.handoffKey
        })).agentThread
      }
    } else if (current.review.status === 'editing') {
      agentThread = null
    }

    const response = await requestJson(
      endpointPath,
      'POST',
      `/reviews/${encodedReviewId}/get-for-review`,
      {
        ...(agentThread !== undefined ? { agentThread } : {}),
        ...(parsed.pullRequestStatus
          ? { pullRequestStatus: parsed.pullRequestStatus }
          : {})
      }
    )
    try {
      return decodeReviewArtifact(response, parsed.reviewId)
    } catch (error) {
      if (error instanceof ReviewFormatError) {
        throw new LocalServiceError(error.code, error.message)
      }
      throw error
    }
  }
  if (parsed.command === 'done') {
    return requestAuthorJson('POST', '/reviews/done', {
      pullRequestUrl: parsed.pullRequestUrl,
      pullRequestStatus: parsed.pullRequestStatus
    })
  }
  const reviewId = encodeURIComponent(parsed.reviewId)
  if (parsed.command === 'get') {
    const response = await requestAuthorJson(
      'POST',
      `/reviews/${reviewId}/handoff`,
      parsed.pullRequestStatus
        ? { pullRequestStatus: parsed.pullRequestStatus }
        : undefined
    )
    try {
      return decodeReviewArtifact(response, parsed.reviewId)
    } catch (error) {
      if (error instanceof ReviewFormatError) {
        throw new LocalServiceError(error.code, error.message)
      }
      throw error
    }
  }
  if (parsed.command === 'revise') {
    return requestAuthorJson(
      'POST',
      `/reviews/${reviewId}/revise`,
      parsed.pullRequestStatus
        ? { pullRequestStatus: parsed.pullRequestStatus }
        : undefined
    )
  }
  return requestAuthorJson('POST', `/reviews/${reviewId}/edit`)
}

export async function main(
  args: string[] = process.argv.slice(2),
  options: ExecuteCommandOptions = {}
): Promise<void> {
  try {
    const parsed = parseCommandArguments(args)
    const result = await executeCommand(parsed, options)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (
      result !== null &&
      typeof result === 'object' &&
      Reflect.get(result, 'format') === 'markover-canonical-doctor' &&
      Reflect.get(result, 'status') === 'unhealthy'
    ) process.exitCode = 1
  } catch (error) {
    process.stderr.write(formatCommandError(error))
    process.exitCode = 1
  }
}

if (require.main === module) void main()

export { defaultEndpointPath }
