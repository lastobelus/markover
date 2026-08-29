import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  addressedDevelopmentExecutable,
  buildAddressedDevelopmentBundle
} from './development-bundle'
import {
  captureLaunchEnvironment,
  captureSource,
  prepareCaptureState
} from './capture-media'

const logicalWidth = 1180
const logicalHeight = 760
const deviceScaleFactor = 2
const pixelWidth = logicalWidth * deviceScaleFactor
const pixelHeight = logicalHeight * deviceScaleFactor
const pixelsPerMetre = 5669
const connectTimeoutMs = 30_000

interface CdpTarget {
  type: string
  url: string
  webSocketDebuggerUrl: string
}

interface CdpResponse {
  error?: { message?: string }
  id?: number
  result?: Record<string, unknown>
}

interface PendingCommand {
  reject: (reason: Error) => void
  resolve: (value: Record<string, unknown>) => void
}

interface ScreenshotSpec {
  colorType: number
  height: number
  pixelsPerMetreX: number | null
  pixelsPerMetreY: number | null
  unit: number | null
  width: number
}

class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, PendingCommand>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse
      if (response.id === undefined) return
      const command = this.pending.get(response.id)
      if (!command) return
      this.pending.delete(response.id)
      if (response.error) {
        command.reject(new Error(response.error.message || 'CDP command failed.'))
      } else command.resolve(response.result || {})
    })
    socket.addEventListener('close', () => {
      for (const command of this.pending.values()) {
        command.reject(new Error('Capture browser connection closed.'))
      }
      this.pending.clear()
    })
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out opening CDP socket.'))
      }, 5_000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Could not open CDP socket.'))
      }, { once: true })
    })
    return new CdpClient(socket)
  }

  close(): void {
    this.socket.close()
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true
    })
    if (response.exceptionDetails) throw new Error(`Capture expression failed: ${expression}`)
    const result = response.result as { value?: T } | undefined
    return result?.value as T
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
  return chunk
}

export function pngWithDensity(source: Buffer): Buffer {
  const signature = source.subarray(0, 8)
  if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Capture output is not a PNG.')
  }
  const density = Buffer.alloc(9)
  density.writeUInt32BE(pixelsPerMetre, 0)
  density.writeUInt32BE(pixelsPerMetre, 4)
  density.writeUInt8(1, 8)
  const chunks: Buffer[] = [signature]
  let offset = 8
  let inserted = false
  while (offset < source.length) {
    const length = source.readUInt32BE(offset)
    const end = offset + length + 12
    if (end > source.length) throw new Error('Capture PNG has a truncated chunk.')
    const type = source.toString('ascii', offset + 4, offset + 8)
    if (type !== 'pHYs') chunks.push(source.subarray(offset, end))
    if (type === 'IHDR') {
      chunks.push(pngChunk('pHYs', density))
      inserted = true
    }
    offset = end
  }
  if (!inserted) throw new Error('Capture PNG has no IHDR chunk.')
  return Buffer.concat(chunks)
}

export function screenshotSpec(source: Buffer): ScreenshotSpec {
  if (source.length < 33 || source.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Capture output has no PNG header.')
  }
  const spec: ScreenshotSpec = {
    width: source.readUInt32BE(16),
    height: source.readUInt32BE(20),
    colorType: source.readUInt8(25),
    pixelsPerMetreX: null,
    pixelsPerMetreY: null,
    unit: null
  }
  let offset = 8
  while (offset < source.length) {
    const length = source.readUInt32BE(offset)
    const type = source.toString('ascii', offset + 4, offset + 8)
    if (type === 'pHYs' && length === 9) {
      spec.pixelsPerMetreX = source.readUInt32BE(offset + 8)
      spec.pixelsPerMetreY = source.readUInt32BE(offset + 12)
      spec.unit = source.readUInt8(offset + 16)
    }
    offset += length + 12
  }
  return spec
}

async function reservePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve capture port.')
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error) reject(error)
    else resolve()
  }))
  return address.port
}

async function pageTarget(port: number): Promise<CdpTarget> {
  const deadline = Date.now() + connectTimeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`)
      if (response.ok) {
        const targets = await response.json() as CdpTarget[]
        const target = targets.find(({ type, url }) => (
          type === 'page' && url.startsWith('markover-app://app/src/index.html')
        ))
        if (target) return target
      }
    } catch {
      // The disposable app may still be starting.
    }
    await delay(150)
  }
  throw new Error('Timed out waiting for the capture renderer.')
}

async function waitFor(client: CdpClient, expression: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await client.evaluate<boolean>(`Boolean(${expression})`)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for capture state: ${expression}`)
}

async function click(client: CdpClient, selector: string): Promise<void> {
  const point = await client.evaluate<{ x: number; y: number } | null>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement) || !element.getClientRects().length) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`)
  if (!point) throw new Error(`Capture control is not visible: ${selector}`)
  await client.send('Input.dispatchMouseEvent', {
    button: 'left', clickCount: 1, type: 'mousePressed', x: point.x, y: point.y
  })
  await client.send('Input.dispatchMouseEvent', {
    button: 'left', clickCount: 1, type: 'mouseReleased', x: point.x, y: point.y
  })
}

async function chooseNeedsMe(client: CdpClient): Promise<void> {
  await client.evaluate(`(() => {
    const filter = document.querySelector('#review-filter');
    if (!(filter instanceof HTMLSelectElement)) throw new Error('Missing review filter.');
    filter.value = 'needs-me';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await waitFor(client, `document.querySelector('#review-filter')?.value === 'needs-me'`)
}

async function closeDialogs(client: CdpClient): Promise<void> {
  for (const [dialog, close] of ([
    ['#review-context-drawer', '#review-context-close'],
    ['#image-preview', '#image-preview-close']
  ] as const)) {
    if (await client.evaluate<boolean>(`document.querySelector(${JSON.stringify(dialog)})?.hasAttribute('open')`)) {
      await click(client, close)
    }
  }
}

async function normalize(client: CdpClient): Promise<void> {
  await closeDialogs(client)
  if (await client.evaluate<boolean>(`!document.querySelector('#left-pane')?.getClientRects().length`)) {
    await click(client, '#left-pane-open')
  }
  await click(client, '[data-review-id="mko_capture01"] .review-list-row-open')
  await waitFor(client, `document.querySelector('#document-review-id')?.textContent === 'mko_capture01'`)
  await client.evaluate(`(() => {
    for (const selector of ['#documents-list-tree', '#tree', '#selected-annotation-view', '#annotation-list-view', '#review-context-drawer']) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) element.scrollTop = 0;
    }
  })()`)
}

async function settle(client: CdpClient): Promise<void> {
  await client.evaluate(`(async () => {
    await document.fonts.ready;
    const images = [...document.querySelectorAll('img')].filter((image) => image.getClientRects().length);
    await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', reject, { once: true });
    })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  })()`)
  await waitFor(client, `document.querySelector('#incoming-review-notice')?.hasAttribute('hidden')`)
  await waitFor(client, `!document.querySelector('#toast')?.getClientRects().length`)
}

async function capture(client: CdpClient, outputPath: string): Promise<void> {
  await settle(client)
  const response = await client.send('Page.captureScreenshot', {
    captureBeyondViewport: false,
    format: 'png',
    fromSurface: true,
    optimizeForSpeed: false
  })
  const data = response.data
  if (typeof data !== 'string') throw new Error('Capture returned no PNG data.')
  const output = pngWithDensity(Buffer.from(data, 'base64'))
  const spec = screenshotSpec(output)
  if (
    spec.width !== pixelWidth || spec.height !== pixelHeight ||
    spec.colorType !== 2 || spec.pixelsPerMetreX !== pixelsPerMetre ||
    spec.pixelsPerMetreY !== pixelsPerMetre || spec.unit !== 1
  ) throw new Error(`Invalid capture output: ${JSON.stringify(spec)}`)
  await fs.writeFile(outputPath, output)
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => {
      resolve()
    })),
    delay(5_000).then(() => { throw new Error('Capture app did not stop cleanly.') })
  ])
}

async function run(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Public still capture requires macOS.')
  const checkout = path.resolve(__dirname, '../..')
  const source = captureSource(checkout)
  const prepared = await prepareCaptureState({ checkout, source })
  await buildAddressedDevelopmentBundle(prepared.instance)
  const port = await reservePort()
  const executable = addressedDevelopmentExecutable(prepared.instance)
  const child = spawn(executable, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${String(port)}`
  ], {
    env: captureLaunchEnvironment(prepared.instance),
    stdio: 'ignore'
  })
  const staging = await fs.mkdtemp(path.join(checkout, '.capture-stills-'))
  let client: CdpClient | null = null
  let readyToPublish = false
  try {
    const target = await pageTarget(port)
    client = await CdpClient.connect(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor,
      height: logicalHeight,
      mobile: false,
      width: logicalWidth
    })
    await waitFor(client, `document.querySelector('#pane-layout')?.getClientRects().length`)
    const viewport = await client.evaluate<{ devicePixelRatio: number; innerHeight: number; innerWidth: number }>(
      `({ devicePixelRatio, innerHeight, innerWidth })`
    )
    if (
      viewport.innerWidth !== logicalWidth || viewport.innerHeight !== logicalHeight ||
      viewport.devicePixelRatio !== deviceScaleFactor
    ) throw new Error(`Unexpected capture viewport: ${JSON.stringify(viewport)}`)

    await normalize(client)
    await click(client, '#review-navigation-inbox')
    await chooseNeedsMe(client)
    await click(client, '.block-row[data-node-id="block-1"]')
    await click(client, '#annotation-view-selected')
    await waitFor(client, `['img-1', 'img-2'].every((id) => {
      const image = document.querySelector('.attachment-item[data-attachment-id="' + id + '"] img');
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    })`)
    await capture(client, path.join(staging, 'markover-review-editor@2x.png'))

    await click(client, '#review-navigation-projects')
    await click(client, '#annotation-view-list')
    await waitFor(client, `document.querySelector('#annotation-view-list')?.getAttribute('aria-selected') === 'true'`)
    await waitFor(client, `document.querySelectorAll('#annotation-list .rendered-annotation').length === 4`)
    await waitFor(client, `document.querySelectorAll('.review-project-group[open]').length === 3`)
    await capture(client, path.join(staging, 'markover-annotation-browser@2x.png'))

    await click(client, '#review-navigation-inbox')
    await chooseNeedsMe(client)
    await click(client, '#annotation-view-selected')
    await click(client, '.block-row[data-node-id="block-2"]')
    if (await client.evaluate<boolean>(`document.querySelector('#source-toggle')?.getAttribute('aria-expanded') !== 'true'`)) {
      await click(client, '#source-toggle')
    }
    await waitFor(client, `document.querySelector('#source-diff:not([hidden]):not(.is-loading)')?.children.length`)
    await waitFor(client, `document.querySelector('#source-diff-stats')?.textContent?.trim().length`)
    await capture(client, path.join(staging, 'markover-source-edit@2x.png'))

    await click(client, '.block-row[data-node-id="block-1"]')
    await click(client, '#review-context-button')
    await waitFor(client, `document.querySelector('#review-context-drawer')?.hasAttribute('open')`)
    await waitFor(client, `document.querySelector('#review-context-summary')?.textContent?.trim().length`)
    await waitFor(client, `document.querySelector('#review-context-fields')?.children.length`)
    await client.evaluate(`document.querySelector('#review-context-drawer').scrollTop = 0`)
    await capture(client, path.join(staging, 'markover-review-context@2x.png'))
    readyToPublish = true
  } finally {
    client?.close()
    await stop(child)
    await prepareCaptureState({ checkout, source, serviceRunning: () => Promise.resolve(false) })
    if (!readyToPublish) await fs.rm(staging, { recursive: true, force: true })
  }

  const assets = path.join(checkout, 'docs', 'user', 'assets')
  for (const filename of [
    'markover-review-editor@2x.png',
    'markover-annotation-browser@2x.png',
    'markover-source-edit@2x.png',
    'markover-review-context@2x.png'
  ]) {
    await fs.copyFile(path.join(staging, filename), path.join(assets, filename))
  }
  await fs.rm(staging, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({
    commit: source.commit,
    outputs: 4,
    pixels: `${String(pixelWidth)}x${String(pixelHeight)}`,
    densityDpi: 144,
    palette: 'ember',
    appearance: 'light'
  })}\n`)
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover still capture: ${message}\n`)
    process.exitCode = 1
  })
}
