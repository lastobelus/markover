import fs from 'node:fs/promises'
import path from 'node:path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface DisplayGeometry {
  bounds: Rect
  workArea: Rect
}

interface Size {
  width: number
  height: number
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : null
}

export function parseWindowBounds(value: unknown): WindowBounds | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const x = finiteInteger(record.x)
  const y = finiteInteger(record.y)
  const width = finiteInteger(record.width)
  const height = finiteInteger(record.height)
  if (x === null || y === null || width === null || height === null) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height, maximized: record.maximized === true }
}

/**
 * Keeps a remembered window on screen. A display can disappear or shrink
 * between runs, so restored bounds are fitted to the current work area
 * rather than trusted.
 */
export function clampWindowBounds(
  bounds: WindowBounds,
  workArea: Rect,
  minimum: Size
): WindowBounds {
  const width = Math.min(
    Math.max(bounds.width, minimum.width),
    workArea.width
  )
  const height = Math.min(
    Math.max(bounds.height, minimum.height),
    workArea.height
  )
  const x = Math.min(
    Math.max(bounds.x, workArea.x),
    workArea.x + workArea.width - width
  )
  const y = Math.min(
    Math.max(bounds.y, workArea.y),
    workArea.y + workArea.height - height
  )
  return { x, y, width, height, maximized: bounds.maximized }
}

/**
 * Restores a window to the connected display it previously occupied. If its
 * display is gone, the primary work area is the predictable fallback.
 */
export function workAreaForWindowBounds(
  bounds: WindowBounds,
  displays: readonly DisplayGeometry[],
  primaryWorkArea: Rect
): Rect {
  let bestWorkArea: Rect | null = null
  let bestIntersectionArea = 0

  for (const display of displays) {
    const intersectionWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, display.bounds.x + display.bounds.width)
        - Math.max(bounds.x, display.bounds.x)
    )
    const intersectionHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, display.bounds.y + display.bounds.height)
        - Math.max(bounds.y, display.bounds.y)
    )
    const intersectionArea = intersectionWidth * intersectionHeight
    if (intersectionArea > bestIntersectionArea) {
      bestIntersectionArea = intersectionArea
      bestWorkArea = display.workArea
    }
  }

  return bestWorkArea ?? primaryWorkArea
}

/**
 * Window geometry is a convenience, never review data, so every failure
 * here is swallowed and the app falls back to its default size.
 */
export class WindowBoundsStore {
  readonly filePath: string
  bounds: WindowBounds | null = null
  private writer: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<WindowBounds | null> {
    try {
      const parsed: unknown = JSON.parse(
        await fs.readFile(this.filePath, 'utf8')
      )
      this.bounds = parseWindowBounds(parsed)
    } catch {
      this.bounds = null
    }
    return this.bounds
  }

  save(bounds: WindowBounds): void {
    this.bounds = bounds
    this.writer = this.writer.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true })
        await fs.writeFile(
          this.filePath,
          `${JSON.stringify(bounds, null, 2)}\n`,
          'utf8'
        )
      } catch {
        /* A window that cannot record its size still opens. */
      }
    })
  }

  async flush(): Promise<void> {
    await this.writer
  }
}
