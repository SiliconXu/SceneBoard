import { describe, expect, it } from 'vitest'
import { proximityGuides, type GuideRect } from './guides'

const moving: GuideRect = { id: 'moving', x: 100, y: 100, width: 100, height: 100 }
describe('image proximity guides', () => {
  it('measures edge-to-edge spacing and shows aligned edges', () => {
    const guides = proximityGuides(moving, [{ ...moving, id: 'other', x: 230 }], 1)!
    expect(guides.measurements).toEqual([{ axis: 'x', distance: 30, start: { x: 200, y: 150 }, end: { x: 230, y: 150 } }])
    expect(guides.alignments).toHaveLength(1)
  })
  it('measures both axes for diagonal neighbors', () => {
    expect(proximityGuides(moving, [{ ...moving, id: 'other', x: 212, y: 216 }], 1)!.measurements.map(line => line.distance)).toEqual([12, 16])
  })
  it('chooses one nearest object and ignores the moving object', () => {
    expect(proximityGuides(moving, [moving, { ...moving, id: 'far', x: 260 }, { ...moving, id: 'near', x: 230 }], 1)!.targetId).toBe('near')
  })
  it('bases proximity on screen pixels and leaves measured distances in original pixels', () => {
    const other = { ...moving, id: 'other', x: 250 }
    expect(proximityGuides(moving, [other], .5)!.measurements[0]!.distance).toBe(50)
    expect(proximityGuides(moving, [other], .7)).toBeNull()
  })
  it('shows only alignments when rectangles overlap', () => {
    const guides = proximityGuides(moving, [{ ...moving, id: 'other', x: 150 }], 1)!
    expect(guides.measurements).toEqual([])
    expect(guides.alignments).toHaveLength(2)
  })
  it('treats near alignment as a hint without mutating geometry', () => {
    const other = { ...moving, id: 'other', x: 202 }
    expect(proximityGuides(moving, [other], 1)!.alignments).toHaveLength(2)
    expect(moving.x).toBe(100)
    expect(other.x).toBe(202)
  })
  it('measures neighbors on the left and above', () => {
    expect(proximityGuides(moving, [{ ...moving, id: 'left', x: -20 }], 1)!.measurements[0]!.distance).toBe(20)
    expect(proximityGuides(moving, [{ ...moving, id: 'top', y: -20 }], 1)!.measurements[0]!.axis).toBe('y')
  })
  it('returns no hints for missing targets, invalid scales, or distant objects', () => {
    expect(proximityGuides(moving, [], 1)).toBeNull()
    expect(proximityGuides(moving, [moving], 1)).toBeNull()
    expect(proximityGuides(moving, [{ ...moving, id: 'other' }], 0)).toBeNull()
    expect(proximityGuides(moving, [{ ...moving, id: 'far', x: 500, y: 500 }], 1)).toBeNull()
  })
  it('includes exactly 30 screen pixels and excludes distances above the threshold', () => {
    expect(proximityGuides(moving, [{ ...moving, id: 'edge', x: 230 }], 1)).not.toBeNull()
    expect(proximityGuides(moving, [{ ...moving, id: 'outside', x: 230.01 }], 1)).toBeNull()
  })
})
