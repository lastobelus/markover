import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  addressedDevelopmentExecutable,
  buildAddressedDevelopmentBundle
} from './development-bundle'
import {
  captureLaunchEnvironment,
  captureSource,
  prepareCaptureState
} from './capture-media'
import {
  CdpClient,
  chooseNeedsMe,
  click,
  pageTarget,
  reservePort,
  settle,
  stop,
  waitFor
} from './capture-stills'

const width = 1920
const height = 1080
const framesPerSecond = 30
const movementFramesPerSecond = 10
const outputFilename = 'markover-focused-preview-demo.mp4'
const posterFilename = 'markover-demo-poster.jpg'

class DemoFrames {
  private count = 0

  constructor(
    private readonly client: CdpClient,
    private readonly directory: string
  ) {}

  get durationSeconds(): number {
    return this.count / framesPerSecond
  }

  private filename(index: number): string {
    return path.join(this.directory, `frame-${String(index).padStart(5, '0')}.jpg`)
  }

  async add(repetitions = 1): Promise<string> {
    await settle(this.client)
    const response = await this.client.send('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'jpeg',
      fromSurface: true,
      optimizeForSpeed: false,
      quality: 88
    })
    const data = response.data
    if (typeof data !== 'string') throw new Error('Demo capture returned no JPEG data.')
    const first = this.filename(this.count)
    await fs.writeFile(first, Buffer.from(data, 'base64'))
    this.count += 1
    for (let index = 1; index < repetitions; index += 1) {
      await fs.link(first, this.filename(this.count))
      this.count += 1
    }
    return first
  }

  hold(seconds: number): Promise<string> {
    return this.add(seconds * framesPerSecond)
  }

  async move(from: Point, to: Point, seconds = 1): Promise<Point> {
    const steps = seconds * movementFramesPerSecond
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps
      const point = {
        x: Math.round(from.x + ((to.x - from.x) * progress)),
        y: Math.round(from.y + ((to.y - from.y) * progress))
      }
      await setPointer(this.client, point)
      await this.add(framesPerSecond / movementFramesPerSecond)
    }
    return to
  }
}

interface Point {
  x: number
  y: number
}

async function pointFor(client: CdpClient, selector: string): Promise<Point> {
  const point = await client.evaluate<Point | null>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement) || !element.getClientRects().length) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`)
  if (!point) throw new Error(`Demo target is not visible: ${selector}`)
  return point
}

async function installOverlay(client: CdpClient): Promise<void> {
  await client.evaluate(`(() => {
    const style = document.createElement('style');
    style.id = 'capture-demo-style';
    style.textContent = \`
      #capture-demo-caption { position: fixed; z-index: 2147483645; left: 50%; bottom: 36px;
        transform: translateX(-50%); max-width: 1500px; padding: 16px 28px; border-radius: 14px;
        background: rgba(38, 33, 30, .94); color: #fffdf9; font: 650 25px/1.25 -apple-system,
        BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; letter-spacing: .01em;
        box-shadow: 0 10px 32px rgba(38, 33, 30, .2); pointer-events: none; }
      #capture-demo-pointer { position: fixed; z-index: 2147483647; width: 34px; height: 44px;
        pointer-events: none; filter: drop-shadow(0 2px 2px rgba(38,33,30,.45)); }
      #capture-demo-scene { position: fixed; z-index: 2147483646; inset: 0; display: none;
        box-sizing: border-box; background: #e8e2d8; color: #26211e; }
      #capture-demo-scene.is-visible { display: flex; }
      #capture-demo-scene .terminal { width: min(1500px, calc(100vw - 160px)); margin: auto;
        border: 1px solid #ddd5cc; border-radius: 18px; overflow: hidden; background: #262b2b;
        color: #f7f4ee; box-shadow: 0 22px 70px rgba(38,33,30,.2); }
      #capture-demo-scene .terminal-title { padding: 15px 22px; background: #ece9e2; color: #6f6761;
        font: 650 18px/1.2 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
      #capture-demo-scene pre { box-sizing: border-box; max-height: 760px; margin: 0; padding: 34px 40px;
        overflow: hidden; white-space: pre-wrap; font: 18px/1.42 ui-monospace, "SF Mono", Menlo, monospace; }
      #capture-demo-scene .end-card { margin: auto; text-align: center; }
      #capture-demo-scene .end-card img { width: 600px; max-height: 180px; }
      #capture-demo-scene .end-card p { margin: 34px 0 0; color: #6f6761;
        font: 30px/1.35 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
      #capture-demo-scene .end-card code { display: block; margin-top: 30px; color: #6d211f;
        font: 24px/1.3 ui-monospace, "SF Mono", Menlo, monospace; }
    \`;
    const caption = document.createElement('div');
    caption.id = 'capture-demo-caption';
    const pointer = document.createElement('div');
    pointer.id = 'capture-demo-pointer';
    pointer.innerHTML = '<svg viewBox="0 0 34 44" aria-hidden="true"><path d="M3 2 L29 25 L18 27 L24 40 L17 43 L11 29 L3 36 Z" fill="#fffdf9" stroke="#26211e" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    const scene = document.createElement('section');
    scene.id = 'capture-demo-scene';
    document.head.append(style);
    document.body.append(caption, pointer, scene);
  })()`)
}

async function setCaption(client: CdpClient, text: string): Promise<void> {
  await client.evaluate(`document.querySelector('#capture-demo-caption').textContent = ${JSON.stringify(text)}`)
}

async function setPointer(client: CdpClient, point: Point): Promise<void> {
  await client.evaluate(`(() => {
    const pointer = document.querySelector('#capture-demo-pointer');
    pointer.style.left = ${JSON.stringify(`${String(point.x)}px`)};
    pointer.style.top = ${JSON.stringify(`${String(point.y)}px`)};
  })()`)
}

async function showTerminal(client: CdpClient, command: string, output: string): Promise<void> {
  await client.evaluate(`(() => {
    document.querySelector('#capture-demo-caption').style.display = 'none';
    document.querySelector('#capture-demo-pointer').style.display = 'none';
    const scene = document.querySelector('#capture-demo-scene');
    scene.className = 'is-visible';
    scene.replaceChildren();
    const terminal = document.createElement('div');
    terminal.className = 'terminal';
    const title = document.createElement('div');
    title.className = 'terminal-title';
    title.textContent = 'Agent retrieves one structured handoff';
    const pre = document.createElement('pre');
    pre.textContent = ${JSON.stringify(`$ ${command}\n\n${output}`)};
    terminal.append(title, pre);
    scene.append(terminal);
  })()`)
}

async function showEndCard(client: CdpClient): Promise<void> {
  await client.evaluate(`(() => {
    const scene = document.querySelector('#capture-demo-scene');
    scene.className = 'is-visible';
    scene.replaceChildren();
    const card = document.createElement('div');
    card.className = 'end-card';
    const logo = document.querySelector('#brand-mark').cloneNode(true);
    logo.removeAttribute('id');
    const line = document.createElement('p');
    line.textContent = 'Structured review for Markdown';
    const url = document.createElement('code');
    url.textContent = 'github.com/lastobelus/markover';
    card.append(logo, line, url);
    scene.append(card);
  })()`)
}

function projectedHandoff(checkout: string): string {
  const review = execFileSync('node', [
    path.join(checkout, 'build', 'scripts', 'capture-cli.js'),
    'get',
    'mko_capture01'
  ], { cwd: checkout, encoding: 'utf8' })
  return execFileSync('jq', [
    '-f',
    path.join(checkout, 'doc', 'launch', 'issue-16', 'handoff-summary.jq')
  ], { cwd: checkout, encoding: 'utf8', input: review }).trim()
}

function mp4HasFastStart(source: Buffer): boolean {
  let offset = 0
  let moov = -1
  let mdat = -1
  while (offset + 8 <= source.length) {
    const size = source.readUInt32BE(offset)
    const type = source.toString('ascii', offset + 4, offset + 8)
    if (type === 'moov') moov = offset
    if (type === 'mdat') mdat = offset
    if (size < 8) break
    offset += size
  }
  return moov >= 0 && mdat >= 0 && moov < mdat
}

async function run(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Public demo capture requires macOS.')
  const checkout = path.resolve(__dirname, '../..')
  const source = captureSource(checkout)
  const prepared = await prepareCaptureState({ checkout, source })
  await buildAddressedDevelopmentBundle(prepared.instance)
  const port = await reservePort()
  const executable = addressedDevelopmentExecutable(prepared.instance)
  const child: ChildProcess = spawn(executable, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${String(port)}`
  ], { env: captureLaunchEnvironment(prepared.instance), stdio: 'ignore' })
  const staging = await fs.mkdtemp(path.join(checkout, '.capture-demo-'))
  const framesDirectory = path.join(staging, 'frames')
  await fs.mkdir(framesDirectory)
  let client: CdpClient | null = null
  let readyToPublish = false
  try {
    const target = await pageTarget(port)
    client = await CdpClient.connect(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height,
      mobile: false,
      width
    })
    await waitFor(client, `document.querySelector('#pane-layout')?.getClientRects().length`)
    await installOverlay(client)
    await click(client, '#review-navigation-inbox')
    await chooseNeedsMe(client)
    await click(client, '.block-row[data-node-id="block-1"]')
    await click(client, '#annotation-view-selected')
    const frames = new DemoFrames(client, framesDirectory)
    let pointer: Point = { x: 1780, y: 80 }
    await setPointer(client, pointer)

    await setCaption(client, 'Review agent-written Markdown as a document tree.')
    const posterPath = await frames.hold(6)

    const attachment = await pointFor(client, '.attachment-item[data-attachment-id="img-1"]')
    pointer = await frames.move(pointer, attachment)
    await setCaption(client, 'Attach labeled visual context to one exact block.')
    await frames.hold(7)

    const paragraph = await pointFor(client, '.block-row[data-node-id="block-2"]')
    pointer = await frames.move(pointer, paragraph)
    await click(client, '.block-row[data-node-id="block-2"]')
    await waitFor(client, `document.querySelector('#source-diff:not([hidden]):not(.is-loading)')?.children.length`)
    await setCaption(client, 'Propose an exact edit without changing the source document.')
    await frames.hold(8)

    const projects = await pointFor(client, '#review-navigation-projects')
    pointer = await frames.move(pointer, projects)
    await click(client, '#review-navigation-projects')
    const annotations = await pointFor(client, '#annotation-view-list')
    pointer = await frames.move(pointer, annotations)
    await click(client, '#annotation-view-list')
    await waitFor(client, `document.querySelectorAll('#annotation-list .rendered-annotation').length === 4`)
    await setCaption(client, 'Scan the complete review before handing it back.')
    await frames.hold(7)

    const command = 'npm --silent run capture:cli -- get mko_capture01 | jq -f doc/launch/issue-16/handoff-summary.jq'
    await showTerminal(client, command, projectedHandoff(checkout))
    await frames.hold(8)

    await showEndCard(client)
    await frames.hold(4)
    const durationSeconds = frames.durationSeconds
    if (durationSeconds < 30 || durationSeconds > 60) {
      throw new Error(`Demo duration is outside 30-60 seconds: ${String(durationSeconds)}`)
    }

    const encoded = path.join(staging, 'encoded.mp4')
    const final = path.join(staging, outputFilename)
    execFileSync('swift', [
      path.join(checkout, 'scripts', 'encode-demo.swift'),
      framesDirectory,
      encoded
    ], { cwd: checkout, stdio: 'inherit' })
    execFileSync('avconvert', [
      '--source', encoded,
      '--preset', 'PresetPassthrough',
      '--output', final,
      '--replace'
    ], { cwd: checkout, stdio: 'inherit' })
    const movie = await fs.readFile(final)
    if (!mp4HasFastStart(movie) || !movie.includes(Buffer.from('avc1'))) {
      throw new Error('Demo MP4 is not fast-start H.264.')
    }
    if (movie.includes(Buffer.from('soun')) || movie.includes(Buffer.from('mp4a'))) {
      throw new Error('Demo MP4 unexpectedly contains audio.')
    }
    await fs.writeFile(path.join(staging, 'result.json'), JSON.stringify({
      durationSeconds,
      posterPath
    }), 'utf8')
    readyToPublish = true
  } finally {
    client?.close()
    await stop(child)
    await prepareCaptureState({ checkout, source, serviceRunning: () => Promise.resolve(false) })
    if (!readyToPublish) await fs.rm(staging, { recursive: true, force: true })
  }

  const result = JSON.parse(await fs.readFile(
    path.join(staging, 'result.json'),
    'utf8'
  )) as { durationSeconds: number; posterPath: string }
  const assets = path.join(checkout, 'docs', 'user', 'assets')
  await fs.copyFile(path.join(staging, outputFilename), path.join(assets, outputFilename))
  await fs.copyFile(result.posterPath, path.join(assets, posterFilename))
  const movie = await fs.readFile(path.join(assets, outputFilename))
  const poster = await fs.readFile(path.join(assets, posterFilename))
  await fs.rm(staging, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({
    appearance: 'light',
    codec: 'h264',
    commit: source.commit,
    durationSeconds: result.durationSeconds,
    framesPerSecond,
    movieSha256: createHash('sha256').update(movie).digest('hex'),
    palette: 'ember',
    posterSha256: createHash('sha256').update(poster).digest('hex'),
    resolution: `${String(width)}x${String(height)}`,
    silent: true
  })}\n`)
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`markover demo capture: ${message}\n`)
    process.exitCode = 1
  })
}
