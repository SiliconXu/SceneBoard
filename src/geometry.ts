export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect extends Point, Size {}
export type Corner = 'nw' | 'ne' | 'sw' | 'se'

export function anchorPoints(rect: Rect) {
  const left = rect.x, midX = rect.x + rect.width / 2, right = rect.x + rect.width
  const top = rect.y, midY = rect.y + rect.height / 2, bottom = rect.y + rect.height
  return {
    topleft: { x: left, y: top }, midtop: { x: midX, y: top }, topright: { x: right, y: top },
    midleft: { x: left, y: midY }, center: { x: midX, y: midY }, midright: { x: right, y: midY },
    bottomleft: { x: left, y: bottom }, midbottom: { x: midX, y: bottom }, bottomright: { x: right, y: bottom },
  }
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function fitImage(image: Size, background: Size): Rect {
  const scale = Math.min(1, background.width / image.width, background.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return { x: (background.width - width) / 2, y: (background.height - height) / 2, width, height }
}

export function moveRect(rect: Rect, delta: Point, bounds: Size): Rect {
  return { ...rect, x: clamp(rect.x + delta.x, 0, bounds.width - rect.width), y: clamp(rect.y + delta.y, 0, bounds.height - rect.height) }
}

// Project the pointer onto the aspect-ratio diagonal. The opposite corner stays fixed.
export function resizeRect(rect: Rect, corner: Corner, pointer: Point, bounds: Size): Rect {
  const sx = corner.endsWith('e') ? 1 : -1
  const sy = corner.startsWith('s') ? 1 : -1
  const anchor = { x: sx === 1 ? rect.x : rect.x + rect.width, y: sy === 1 ? rect.y : rect.y + rect.height }
  const ratio = rect.height / rect.width
  const dx = (pointer.x - anchor.x) * sx
  const dy = (pointer.y - anchor.y) * sy
  const requestedWidth = (dx + dy * ratio) / (1 + ratio * ratio)
  const maxWidth = Math.min(sx === 1 ? bounds.width - anchor.x : anchor.x, (sy === 1 ? bounds.height - anchor.y : anchor.y) / ratio)
  const minWidth = Math.min(8, maxWidth)
  const width = clamp(requestedWidth, minWidth, maxWidth)
  const height = width * ratio
  return { x: sx === 1 ? anchor.x : anchor.x - width, y: sy === 1 ? anchor.y : anchor.y - height, width, height }
}

export function screenToImage(point: Point, origin: Point, scale: number): Point {
  return { x: (point.x - origin.x) / scale, y: (point.y - origin.y) / scale }
}

export function drawRect(start: Point, pointer: Point, bounds: Size, free: boolean): Rect {
  const end = { x: clamp(pointer.x, 0, bounds.width), y: clamp(pointer.y, 0, bounds.height) }
  const sx = end.x >= start.x ? 1 : -1
  const sy = end.y >= start.y ? 1 : -1
  let width = Math.abs(end.x - start.x)
  let height = Math.abs(end.y - start.y)
  if (!free) {
    const side = Math.min(Math.max(width, height), sx === 1 ? bounds.width - start.x : start.x, sy === 1 ? bounds.height - start.y : start.y)
    width = height = side
  }
  return { x: sx === 1 ? start.x : start.x - width, y: sy === 1 ? start.y : start.y - height, width, height }
}

export function resizeFreeRect(rect: Rect, corner: Corner, pointer: Point, bounds: Size): Rect {
  const sx = corner.endsWith('e') ? 1 : -1
  const sy = corner.startsWith('s') ? 1 : -1
  const anchor = { x: sx === 1 ? rect.x : rect.x + rect.width, y: sy === 1 ? rect.y : rect.y + rect.height }
  const maxWidth = sx === 1 ? bounds.width - anchor.x : anchor.x
  const maxHeight = sy === 1 ? bounds.height - anchor.y : anchor.y
  const width = clamp((pointer.x - anchor.x) * sx, Math.min(8, maxWidth), maxWidth)
  const height = clamp((pointer.y - anchor.y) * sy, Math.min(8, maxHeight), maxHeight)
  return { x: sx === 1 ? anchor.x : anchor.x - width, y: sy === 1 ? anchor.y : anchor.y - height, width, height }
}
