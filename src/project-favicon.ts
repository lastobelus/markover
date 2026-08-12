import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_FAVICON_BYTES = 256 * 1024

const candidates = [
  ['favicon.svg', 'image/svg+xml'],
  ['favicon.png', 'image/png'],
  ['favicon.ico', 'image/x-icon'],
  ['public/favicon.svg', 'image/svg+xml'],
  ['public/favicon.png', 'image/png'],
  ['public/favicon.ico', 'image/x-icon']
] as const

function validPng(buffer: Buffer): boolean {
  return buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
}

function validIco(buffer: Buffer): boolean {
  return buffer.length >= 6 &&
    buffer.readUInt16LE(0) === 0 &&
    buffer.readUInt16LE(2) === 1 &&
    buffer.readUInt16LE(4) > 0
}

function safeSvg(buffer: Buffer): boolean {
  const source = buffer.toString('utf8').trim()
  if (!/^<svg(?:\s|>)/i.test(source)) return false
  return !/<(?:script|foreignObject|iframe|object|embed)\b/i.test(source) &&
    !/<!DOCTYPE/i.test(source) &&
    !/\son[a-z]+\s*=/i.test(source) &&
    !/(?:href|src)\s*=\s*["']\s*(?:https?:|file:|\/\/)/i.test(source)
}

function validFavicon(buffer: Buffer, mimeType: string): boolean {
  if (!buffer.length || buffer.length > MAX_FAVICON_BYTES) return false
  if (mimeType === 'image/png') return validPng(buffer)
  if (mimeType === 'image/x-icon') return validIco(buffer)
  return safeSvg(buffer)
}

export async function discoverProjectFavicon(
  repositoryRoot: string
): Promise<string | null> {
  const root = path.resolve(repositoryRoot)
  for (const [relativePath, mimeType] of candidates) {
    const filePath = path.resolve(root, relativePath)
    if (!filePath.startsWith(`${root}${path.sep}`)) continue
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile() || stat.size > MAX_FAVICON_BYTES) continue
      const buffer = await fs.readFile(filePath)
      if (!validFavicon(buffer, mimeType)) continue
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        (Reflect.get(error, 'code') === 'ENOENT' || Reflect.get(error, 'code') === 'EACCES')
      ) continue
      throw error
    }
  }
  return null
}
