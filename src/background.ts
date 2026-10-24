import type { Size } from './geometry'

export function validCanvasSize(width: number, height: number) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 32767 && height <= 32767 && width * height <= 64_000_000
}

export function assertCanvasSize({ width, height }: Size) {
  if (!validCanvasSize(width, height)) throw new Error('尺寸须为正整数，每边不超过 32767 像素，总像素不超过 6400 万。')
}

export const validColor = (color: string) => /^#[0-9a-f]{6}$/i.test(color)
