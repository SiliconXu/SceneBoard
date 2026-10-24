import { clamp, moveRect, type Point, type Rect, type Size } from './geometry'

export type PositionAnchor = 'center' | 'topleft'
export type RectField = keyof Rect
export type Alignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'
export type Axis = 'x' | 'y'

export function selectionBounds(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null
  if (rects.length === 1) {
    const { x, y, width, height } = rects[0]!
    return { x, y, width, height }
  }
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y))
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y }
}

export function positionAt(rect: Rect, anchor: PositionAnchor): Point {
  return anchor === 'center' ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : { x: rect.x, y: rect.y }
}

// Numeric sizing fixes the chosen anchor; pointer sizing fixes the opposite corner.
export function editRect(rect: Rect, field: RectField, value: number, bounds: Size, anchor: PositionAnchor, proportional: boolean): Rect {
  if (!Number.isFinite(value) || ((field === 'width' || field === 'height') && value <= 0)) throw new Error('请输入有效数字，宽高必须大于 0。')
  const point = positionAt(rect, anchor)
  if (field === 'x' || field === 'y') {
    return moveRect(rect, { x: field === 'x' ? value - point.x : 0, y: field === 'y' ? value - point.y : 0 }, bounds)
  }
  const maxWidth = anchor === 'center' ? 2 * Math.min(point.x, bounds.width - point.x) : bounds.width - point.x
  const maxHeight = anchor === 'center' ? 2 * Math.min(point.y, bounds.height - point.y) : bounds.height - point.y
  let width = rect.width, height = rect.height
  if (proportional) {
    // Keep the dimension the user entered exact, instead of dividing and then
    // multiplying it again (which can display 240.50000000000003).
    if (field === 'width') {
      width = Math.min(value, maxWidth, maxHeight * (rect.width / rect.height))
      height = width * (rect.height / rect.width)
    } else {
      height = Math.min(value, maxHeight, maxWidth * (rect.height / rect.width))
      width = height * (rect.width / rect.height)
    }
  } else if (field === 'width') width = Math.min(value, maxWidth)
  else height = Math.min(value, maxHeight)
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('该尺寸过小或不可用，请重新输入。')
  return { x: anchor === 'center' ? point.x - width / 2 : point.x, y: anchor === 'center' ? point.y - height / 2 : point.y, width, height }
}

export function moveSelection<T extends Rect>(rects: readonly T[], delta: Point, bounds: Size): T[] {
  const box = selectionBounds(rects)
  if (!box) return []
  const target = moveRect(box, delta, bounds)
  return rects.map(rect => ({ ...rect, x: rect.x + (target.x - box.x), y: rect.y + (target.y - box.y) }))
}

export function alignSelection<T extends Rect>(rects: readonly T[], alignment: Alignment): T[] {
  const box = selectionBounds(rects)
  if (!box || rects.length < 2) return [...rects]
  return rects.map(rect => {
    switch (alignment) {
      case 'left': return { ...rect, x: box.x }
      case 'centerX': return { ...rect, x: box.x + (box.width - rect.width) / 2 }
      case 'right': return { ...rect, x: box.x + box.width - rect.width }
      case 'top': return { ...rect, y: box.y }
      case 'centerY': return { ...rect, y: box.y + (box.height - rect.height) / 2 }
      case 'bottom': return { ...rect, y: box.y + box.height - rect.height }
    }
  })
}

// Return null for a disabled operation. Sorting never changes paint order.
export function distributeSelection<T extends Rect>(rects: readonly T[], axis: Axis): T[] | null {
  if (rects.length < 3) return null
  const size = axis === 'x' ? 'width' : 'height'
  const sorted = rects.map((rect, index) => ({ rect, index })).sort((a, b) => a.rect[axis] - b.rect[axis] || a.index - b.index)
  const first = sorted[0]!.rect, last = sorted.at(-1)!.rect
  const available = last[axis] + last[size] - first[axis] - rects.reduce((sum, rect) => sum + rect[size], 0)
  if (available < -1e-9) return null
  const gap = Math.max(0, available) / (rects.length - 1)
  const result = rects.map(rect => ({ ...rect }))
  let cursor = first[axis] + first[size] + gap
  for (let i = 1; i < sorted.length - 1; i++) {
    const { rect, index } = sorted[i]!
    result[index]![axis] = cursor
    cursor += rect[size] + gap
  }
  return result
}

export function containedBy(rect: Rect, box: Rect): boolean {
  return rect.x >= box.x && rect.y >= box.y && rect.x + rect.width <= box.x + box.width && rect.y + rect.height <= box.y + box.height
}

export function pasteSelection<T extends Rect>(rects: readonly T[], bounds: Size, offset: number): T[] {
  const box = selectionBounds(rects)
  if (!box) return []
  const factor = Math.min(1, bounds.width / box.width, bounds.height / box.height)
  const x = clamp(box.x + offset, 0, bounds.width - box.width * factor)
  const y = clamp(box.y + offset, 0, bounds.height - box.height * factor)
  return rects.map(rect => ({ ...rect, x: x + (rect.x - box.x) * factor, y: y + (rect.y - box.y) * factor, width: rect.width * factor, height: rect.height * factor }))
}
