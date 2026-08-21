const REFERENCE_PREFIX = 'mko-ui-v1:'
const MAXIMUM_REFERENCE_LENGTH = 32 * 1024
const MAXIMUM_ANCHOR_LENGTH = 512
const MAXIMUM_PATH_LENGTH = 128
const ELEMENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

interface DevelopmentElementPathSegment {
  count: number
  fingerprint: string
  index: number
  name: string
}

interface DevelopmentElementReferencePayload {
  anchorId: string | null
  path: DevelopmentElementPathSegment[]
  version: 1
}

export interface DevelopmentElementBounds {
  height: number
  width: number
  x: number
  y: number
}

export interface DevelopmentElementCalloutCommand {
  action: 'clear' | 'highlight'
  reference?: string | undefined
  requestId: string
}

export interface DevelopmentElementCalloutRequest {
  action: 'clear' | 'highlight'
  reference?: string | undefined
}

export interface DevelopmentElementCalloutResult {
  bounds?: DevelopmentElementBounds | undefined
  reference?: string | undefined
  requestId: string
  status: 'ambiguous' | 'cleared' | 'highlighted' | 'stale'
}

export interface DevelopmentElementCallouts {
  clear: () => void
  handle: (
    command: DevelopmentElementCalloutCommand
  ) => DevelopmentElementCalloutResult
  reposition: () => DevelopmentElementBounds | null
}

interface DevelopmentElementCalloutOptions {
  copyText: (reference: string) => void
  notify: (message: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const padding = (4 - (value.length % 4)) % 4
  try {
    const binary = atob(
      value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(padding)
    )
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function isPayload(value: unknown): value is DevelopmentElementReferencePayload {
  if (!isRecord(value) || value.version !== 1) return false
  if (
    value.anchorId !== null &&
    (
      typeof value.anchorId !== 'string' ||
      !value.anchorId ||
      value.anchorId.length > MAXIMUM_ANCHOR_LENGTH
    )
  ) return false
  if (!Array.isArray(value.path) || value.path.length > MAXIMUM_PATH_LENGTH) {
    return false
  }
  return value.path.every((segment) => (
    isRecord(segment) &&
    Object.keys(segment).sort().join(',') === 'count,fingerprint,index,name' &&
    typeof segment.name === 'string' &&
    ELEMENT_NAME_PATTERN.test(segment.name) &&
    typeof segment.fingerprint === 'string' &&
    /^[a-f0-9]{32}$/.test(segment.fingerprint) &&
    Number.isInteger(segment.count) &&
    (segment.count as number) > 0 &&
    Number.isInteger(segment.index) &&
    (segment.index as number) >= 0 &&
    (segment.index as number) < (segment.count as number)
  ))
}

function decodeReference(
  reference: string
): DevelopmentElementReferencePayload | null {
  if (
    !reference.startsWith(REFERENCE_PREFIX) ||
    reference.length > MAXIMUM_REFERENCE_LENGTH
  ) return null
  const encoded = reference.slice(REFERENCE_PREFIX.length)
  const decoded = decodeBase64Url(encoded)
  if (decoded === null) return null
  let value: unknown
  try {
    value = JSON.parse(decoded)
  } catch {
    return null
  }
  if (!isPayload(value)) return null
  return `${REFERENCE_PREFIX}${encodeBase64Url(JSON.stringify(value))}` === reference
    ? value
    : null
}

export function isDevelopmentElementReference(value: unknown): value is string {
  return typeof value === 'string' && decodeReference(value) !== null
}

export function isDevelopmentElementCalloutCommand(
  value: unknown
): value is DevelopmentElementCalloutCommand {
  if (!isRecord(value) || !/^element-callout-[1-9]\d*$/.test(String(value.requestId))) {
    return false
  }
  if (value.action === 'clear') {
    return Object.keys(value).length === 2 && value.reference === undefined
  }
  return value.action === 'highlight' &&
    Object.keys(value).length === 3 &&
    isDevelopmentElementReference(value.reference)
}

export function isDevelopmentElementCalloutRequest(
  value: unknown
): value is DevelopmentElementCalloutRequest {
  if (!isRecord(value)) return false
  if (value.action === 'clear') {
    return Object.keys(value).length === 1 && value.reference === undefined
  }
  return value.action === 'highlight' &&
    Object.keys(value).length === 2 &&
    isDevelopmentElementReference(value.reference)
}

export function isDevelopmentElementCalloutResult(
  value: unknown
): value is DevelopmentElementCalloutResult {
  if (
    !isRecord(value) ||
    !/^element-callout-[1-9]\d*$/.test(String(value.requestId)) ||
    !['ambiguous', 'cleared', 'highlighted', 'stale'].includes(String(value.status))
  ) return false
  const allowed = new Set(['bounds', 'reference', 'requestId', 'status'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  if (value.reference !== undefined && !isDevelopmentElementReference(value.reference)) {
    return false
  }
  if (value.status === 'cleared') {
    return value.reference === undefined && value.bounds === undefined
  }
  if (value.reference === undefined) return false
  if (value.status !== 'highlighted') return value.bounds === undefined
  const bounds = value.bounds
  if (!isRecord(bounds)) return false
  return Object.keys(bounds).sort().join(',') === 'height,width,x,y' &&
    ['height', 'width', 'x', 'y'].every((key) => (
      typeof bounds[key] === 'number' &&
      Number.isFinite(bounds[key])
    ))
}

function uniqueIdAnchor(
  element: Element,
  document: Document
): Element | null {
  let current: Element | null = element
  while (current) {
    if (
      current.id &&
      [...document.querySelectorAll('[id]')].filter(
        (candidate) => candidate.id === current?.id
      ).length === 1
    ) return current
    current = current.parentElement
  }
  return null
}

function segmentFor(element: Element): DevelopmentElementPathSegment {
  const parent = element.parentElement
  if (!parent) throw new Error('Development element is outside the document tree.')
  const siblings = [...parent.children].filter(
    (candidate) => candidate.localName === element.localName
  )
  const index = siblings.indexOf(element)
  if (index < 0 || !ELEMENT_NAME_PATTERN.test(element.localName)) {
    throw new Error('Development element path is invalid.')
  }
  return {
    count: siblings.length,
    fingerprint: elementFingerprint(element),
    name: element.localName,
    index
  }
}

const FNV_PRIME_64 = 0x100000001b3n
const FNV_OFFSET_64 = 0xcbf29ce484222325n
const FNV_SECOND_OFFSET_64 = 0x6c62272e07bb0142n

function fingerprintPart(bytes: Uint8Array, seed: bigint): string {
  let hash = seed
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * FNV_PRIME_64)
  }
  return hash.toString(16).padStart(16, '0')
}

function elementFingerprint(element: Element): string {
  const snapshot = element.cloneNode(true) as Element
  const candidates = [snapshot, ...snapshot.querySelectorAll('*')]
  for (const candidate of candidates) {
    if (candidate.hasAttribute('data-markover-development-callout')) {
      candidate.remove()
      continue
    }
    candidate.removeAttribute('style')
    const stableClasses = [...candidate.classList]
      .filter((name) => !name.startsWith('is-') && !name.startsWith('has-'))
      .sort()
    if (stableClasses.length) candidate.setAttribute('class', stableClasses.join(' '))
    else candidate.removeAttribute('class')
    for (const attribute of [
      'aria-activedescendant',
      'aria-busy',
      'aria-checked',
      'aria-current',
      'aria-disabled',
      'aria-expanded',
      'aria-hidden',
      'aria-pressed',
      'aria-selected',
      'tabindex'
    ]) candidate.removeAttribute(attribute)
  }
  const bytes = new TextEncoder().encode(snapshot.outerHTML)
  return `${fingerprintPart(bytes, FNV_OFFSET_64)}${fingerprintPart(
    bytes,
    FNV_SECOND_OFFSET_64
  )}`
}

export function developmentElementReference(
  element: Element,
  document: Document
): string {
  if (!document.documentElement.contains(element) && element !== document.documentElement) {
    throw new Error('Development element is outside the document tree.')
  }
  const anchor = uniqueIdAnchor(element, document)
  const path: DevelopmentElementPathSegment[] = []
  let current = element
  while (current !== (anchor || document.documentElement)) {
    if (path.length >= MAXIMUM_PATH_LENGTH) {
      throw new Error('Development element path exceeds the supported depth.')
    }
    path.unshift(segmentFor(current))
    const parent = current.parentElement
    if (!parent) throw new Error('Development element path is incomplete.')
    current = parent
  }
  const payload: DevelopmentElementReferencePayload = {
    anchorId: anchor?.id || null,
    path,
    version: 1
  }
  const reference = `${REFERENCE_PREFIX}${encodeBase64Url(JSON.stringify(payload))}`
  if (!isDevelopmentElementReference(reference)) {
    throw new Error('Development element reference exceeds the supported limits.')
  }
  return reference
}

export function resolveDevelopmentElementReference(
  reference: string,
  document: Document
): { element: Element; status: 'found' } | { status: 'ambiguous' | 'stale' } {
  const payload = decodeReference(reference)
  if (!payload) return { status: 'stale' }
  let current: Element
  if (payload.anchorId !== null) {
    const anchors = [...document.querySelectorAll('[id]')].filter(
      (candidate) => candidate.id === payload.anchorId
    )
    if (anchors.length > 1) return { status: 'ambiguous' }
    if (anchors.length === 0) return { status: 'stale' }
    current = anchors[0] as Element
  } else {
    current = document.documentElement
  }
  for (const segment of payload.path) {
    const candidates = [...current.children].filter(
      (candidate) => candidate.localName === segment.name
    )
    if (candidates.length !== segment.count) return { status: 'stale' }
    const next = candidates[segment.index]
    if (!next || elementFingerprint(next) !== segment.fingerprint) {
      return { status: 'stale' }
    }
    current = next
  }
  return { element: current, status: 'found' }
}

function roundedBounds(element: Element): DevelopmentElementBounds {
  const bounds = element.getBoundingClientRect()
  return {
    height: Math.round(bounds.height),
    width: Math.round(bounds.width),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y)
  }
}

function hasRenderedVisibility(element: Element, document: Document): boolean {
  const view = document.defaultView
  if (!view) return true
  let current: Element | null = element
  while (current) {
    const style = view.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0' ||
      style.getPropertyValue('content-visibility') === 'hidden'
    ) return false
    current = current.parentElement
  }
  return true
}

function calloutLabel(element: Element): string {
  return element.id ? `${element.localName}#${element.id}` : element.localName
}

export function installDevelopmentElementCallouts(
  document: Document,
  { copyText, notify }: DevelopmentElementCalloutOptions
): DevelopmentElementCallouts {
  const overlay = document.createElement('div')
  overlay.className = 'development-element-callout'
  overlay.dataset.markoverDevelopmentCallout = 'true'
  overlay.hidden = true
  const label = document.createElement('span')
  label.className = 'development-element-callout-label'
  overlay.append(label)
  document.body.append(overlay)
  let pinned: Element | null = null
  let pinnedReference: string | null = null

  const clear = (): void => {
    pinned = null
    pinnedReference = null
    overlay.hidden = true
  }
  const position = (): DevelopmentElementBounds | null => {
    if (
      !pinned ||
      !document.documentElement.contains(pinned) ||
      !hasRenderedVisibility(pinned, document)
    ) {
      clear()
      return null
    }
    const bounds = roundedBounds(pinned)
    if (bounds.width <= 0 || bounds.height <= 0) {
      clear()
      return null
    }
    overlay.style.left = `${String(bounds.x)}px`
    overlay.style.top = `${String(bounds.y)}px`
    overlay.style.width = `${String(bounds.width)}px`
    overlay.style.height = `${String(bounds.height)}px`
    label.textContent = calloutLabel(pinned)
    overlay.hidden = false
    return bounds
  }
  const pin = (
    element: Element,
    reference: string
  ): DevelopmentElementBounds | null => {
    pinned = element
    pinnedReference = reference
    return position()
  }
  const MutationObserver = document.defaultView?.MutationObserver
  const observer = MutationObserver
    ? new MutationObserver((records) => {
        if (
          pinned &&
          records.some((record) => !overlay.contains(record.target))
        ) position()
      })
    : null
  observer?.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true
  })

  const isPickerGesture = (event: MouseEvent): boolean => (
    event.button === 0 &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  )
  document.addEventListener('pointerdown', (event) => {
    if (!isPickerGesture(event)) return
    const target = event.target as Node | null
    if (!target || target.nodeType !== 1) return
    const element = target as Element
    if (overlay.contains(element)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    try {
      const reference = developmentElementReference(element, document)
      if (!pin(element, reference)) {
        throw new Error('Development element has no visible bounds.')
      }
      copyText(reference)
      notify('Element reference copied')
    } catch {
      clear()
      notify('Element cannot be referenced')
    }
  }, true)
  document.addEventListener('click', (event) => {
    if (!isPickerGesture(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
  document.defaultView?.addEventListener('resize', () => { position() })
  document.addEventListener('scroll', () => { position() }, true)

  return {
    clear,
    handle(command) {
      if (command.action === 'clear') {
        clear()
        return { requestId: command.requestId, status: 'cleared' }
      }
      const reference = command.reference as string
      const resolved = resolveDevelopmentElementReference(reference, document)
      if (resolved.status !== 'found') {
        clear()
        return {
          reference,
          requestId: command.requestId,
          status: resolved.status
        }
      }
      const bounds = pin(resolved.element, reference)
      if (!bounds) {
        return {
          reference,
          requestId: command.requestId,
          status: 'stale'
        }
      }
      return {
        bounds,
        reference: pinnedReference as string,
        requestId: command.requestId,
        status: 'highlighted'
      }
    },
    reposition: position
  }
}
