import type { Point, Rect } from './geometry'

export interface GuideRect extends Rect { id: string }
export interface GuideLine { start: Point; end: Point }
export interface Measurement extends GuideLine { axis: 'x' | 'y'; distance: number }
export interface Guides { targetId: string; measurements: Measurement[]; alignments: GuideLine[] }

function gap(a0: number, a1: number, b0: number, b1: number) { return Math.max(0, b0 - a1, a0 - b1) }
function crossPosition(a0: number, a1: number, b0: number, b1: number) {
  return (Math.max(a0, b0) + Math.min(a1, b1)) / 2
}

export function proximityGuides(moving: GuideRect, others: GuideRect[], scale: number): Guides | null {
  if (!(scale > 0)) return null
  const ranked = others.filter(rect => rect.id !== moving.id).map(rect => {
    const dx = gap(moving.x, moving.x + moving.width, rect.x, rect.x + rect.width)
    const dy = gap(moving.y, moving.y + moving.height, rect.y, rect.y + rect.height)
    return { rect, dx, dy, distance: Math.hypot(dx, dy) }
  }).sort((a, b) => a.distance - b.distance)
  const nearest = ranked[0]
  if (!nearest || nearest.distance * scale > 30) return null
  const { rect: other, dx, dy } = nearest
  const measurements: Measurement[] = [], alignments: GuideLine[] = []
  const overlap = moving.x < other.x + other.width && moving.x + moving.width > other.x && moving.y < other.y + other.height && moving.y + moving.height > other.y
  if (!overlap && dx > 0) {
    const left = moving.x < other.x ? moving : other, right = left === moving ? other : moving
    const y = crossPosition(moving.y, moving.y + moving.height, other.y, other.y + other.height)
    measurements.push({ axis: 'x', distance: dx, start: { x: left.x + left.width, y }, end: { x: right.x, y } })
  }
  if (!overlap && dy > 0) {
    const top = moving.y < other.y ? moving : other, bottom = top === moving ? other : moving
    const x = crossPosition(moving.x, moving.x + moving.width, other.x, other.x + other.width)
    measurements.push({ axis: 'y', distance: dy, start: { x, y: top.y + top.height }, end: { x, y: bottom.y } })
  }
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height'
    const a = [moving[axis], moving[axis] + moving[size] / 2, moving[axis] + moving[size]]
    const b = [other[axis], other[axis] + other[size] / 2, other[axis] + other[size]]
    const best = a.flatMap(one => b.map(two => ({ distance: Math.abs(one - two), coordinate: (one + two) / 2 }))).sort((one, two) => one.distance - two.distance)[0]!
    if (best.distance * scale > 3) continue
    if (axis === 'x') alignments.push({ start: { x: best.coordinate, y: Math.min(moving.y, other.y) }, end: { x: best.coordinate, y: Math.max(moving.y + moving.height, other.y + other.height) } })
    else alignments.push({ start: { x: Math.min(moving.x, other.x), y: best.coordinate }, end: { x: Math.max(moving.x + moving.width, other.x + other.width), y: best.coordinate } })
  }
  return { targetId: other.id, measurements, alignments }
}
