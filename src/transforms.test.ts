import { describe, expect, it } from 'vitest'
import { alignSelection, containedBy, distributeSelection, editRect, moveSelection, pasteSelection, positionAt, selectionBounds, type Alignment, type RectField } from './transforms'

const bounds = { width: 800, height: 600 }
const rect = { x: 100.25, y: 120.5, width: 120, height: 60 }
const objects = [
  { id: 'a', x: 10, y: 20, width: 40, height: 20 },
  { id: 'b', x: 90, y: 75, width: 20, height: 30 },
  { id: 'c', x: 190, y: 170, width: 60, height: 40 },
]

describe('precise numeric editing', () => {
  it('changes only the meaning of coordinates when switching anchors', () => {
    expect(positionAt(rect, 'center')).toEqual({ x: 160.25, y: 150.5 })
    expect(positionAt(rect, 'topleft')).toEqual({ x: 100.25, y: 120.5 })
    expect(rect.x).toBe(100.25)
  })
  it('accepts fractional coordinates and clamps both edges for either anchor', () => {
    expect(editRect(rect, 'x', 200.125, bounds, 'center', true)).toMatchObject({ x: 140.125, y: 120.5 })
    expect(editRect(rect, 'x', -1000, bounds, 'center', true).x).toBe(0)
    expect(editRect(rect, 'y', 1000, bounds, 'center', true).y).toBe(540)
    expect(editRect(rect, 'x', 1000, bounds, 'topleft', true).x).toBe(680)
  })
  it.each(['width', 'height'] as RectField[])('sizes %s proportionally around the center', field => {
    const result = editRect(rect, field, field === 'width' ? 240.5 : 120.25, bounds, 'center', true)
    expect(result.width).toBe(240.5)
    expect(result.height).toBe(120.25)
    expect(positionAt(result, 'center')).toEqual(positionAt(rect, 'center'))
    expect(rect.width).toBe(120)
  })
  it('uses both available dimensions to cap proportional size at a fixed top-left', () => {
    const result = editRect(rect, 'width', 100000, bounds, 'topleft', true)
    expect(result).toEqual({ x: 100.25, y: 120.5, width: 699.75, height: 349.875 })
    const bottom = editRect({ x: 100, y: 590, width: 10, height: 5 }, 'width', 1000, bounds, 'topleft', true)
    expect(bottom).toEqual({ x: 100, y: 590, width: 20, height: 10 })
  })
  it('caps center sizing at the nearest edges without moving the anchor', () => {
    const result = editRect(rect, 'height', 100000, bounds, 'center', true)
    expect(result.x).toBe(0)
    expect(result.width).toBe(320.5)
    expect(result.width / result.height).toBe(2)
    expect(positionAt(result, 'center')).toEqual(positionAt(rect, 'center'))
  })
  it('sizes shapes freely and supports positive subpixel dimensions', () => {
    expect(editRect(rect, 'height', 9000, bounds, 'center', false)).toMatchObject({ width: 120, height: 301, y: 0 })
    const small = editRect(rect, 'width', .125, bounds, 'topleft', true)
    expect(small).toMatchObject({ x: 100.25, y: 120.5, width: .125, height: .0625 })
  })
  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid dimensions %s', value => {
    expect(() => editRect(rect, 'width', value, bounds, 'center', true)).toThrow()
  })
})

describe('selection geometry', () => {
  it('gets the combined bounds and empty selection', () => {
    expect(selectionBounds(objects)).toEqual({ x: 10, y: 20, width: 240, height: 190 })
    expect(selectionBounds([])).toBeNull()
    const decimal = { x: .1, y: .2, width: .2, height: .3 }
    expect(selectionBounds([decimal])).toEqual(decimal)
  })
  it.each([{ x: -10000, y: -10000 }, { x: 10000, y: 10000 }])('clamps a common delta at every edge %j', delta => {
    const result = moveSelection(objects, delta, bounds)
    const box = selectionBounds(result)!
    expect(box.x).toBe(delta.x < 0 ? 0 : 560)
    expect(box.y).toBe(delta.y < 0 ? 0 : 410)
    expect(result[1]!.x - result[0]!.x).toBe(80)
    expect(result[2]!.y - result[0]!.y).toBe(150)
    expect(objects[0]!.x).toBe(10)
    expect(result.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })
  it('does not round an unchanged group or change individual sizes', () => {
    const precise = [{ ...rect, id: 'precise' }, { ...rect, id: 'other', x: 101.125 }]
    expect(moveSelection(precise, { x: 0, y: 0 }, bounds)).toEqual(precise)
  })
  it.each(['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] as Alignment[])('aligns %s to the original box and preserves order and sizes', alignment => {
    const result = alignSelection(objects, alignment)
    const box = selectionBounds(objects)!
    const axis = ['left', 'centerX', 'right'].includes(alignment) ? 'x' : 'y'
    const size = axis === 'x' ? 'width' : 'height'
    const fraction = alignment === 'right' || alignment === 'bottom' ? 1 : alignment.startsWith('center') ? .5 : 0
    result.forEach((item, index) => {
      expect(item[axis] + item[size] * fraction).toBeCloseTo(box[axis] + box[size] * fraction)
      expect(item.width).toBe(objects[index]!.width)
      expect(item.height).toBe(objects[index]!.height)
    })
    expect(result.map(item => item.id)).toEqual(['a', 'b', 'c'])
  })
  it.each(['x', 'y'] as const)('distributes unequal sizes on %s with fixed endpoints and equal edge gaps', axis => {
    const source = [objects[2]!, objects[0]!, objects[1]!]
    const result = distributeSelection(source, axis)!
    expect(result[0]).toEqual(source[0])
    expect(result[1]).toEqual(source[1])
    const [first, middle, last] = [result[1]!, result[2]!, result[0]!]
    const size = axis === 'x' ? 'width' : 'height'
    expect(middle[axis] - first[axis] - first[size]).toBeCloseTo(last[axis] - middle[axis] - middle[size])
    expect(result.map(item => item.id)).toEqual(['c', 'a', 'b'])
    expect(source[2]).toEqual(objects[1])
  })
  it('rejects insufficient counts and negative gaps, but permits zero gaps', () => {
    expect(distributeSelection(objects.slice(0, 2), 'x')).toBeNull()
    expect(distributeSelection(objects.map(item => ({ ...item, x: 0 })), 'x')).toBeNull()
    const touching = objects.map((item, index) => ({ ...item, x: index * 20, width: 20 }))
    expect(distributeSelection(touching, 'x')).toEqual(touching)
  })
  it('requires full containment, including transparent rectangular padding', () => {
    expect(containedBy(rect, rect)).toBe(true)
    expect(containedBy(rect, { ...rect, width: rect.width - .01 })).toBe(false)
    expect(containedBy(rect, { ...rect, x: rect.x + 1 })).toBe(false)
  })
  it('pastes the entire selection with a common offset and no source mutation', () => {
    const result = pasteSelection(objects, bounds, 20)
    expect(result[0]).toEqual({ ...objects[0], x: 30, y: 40 })
    expect(result[1]).toEqual({ ...objects[1], x: 110, y: 95 })
    expect(pasteSelection(objects, bounds, 0)).toEqual(objects)
    expect(objects[0]!.x).toBe(10)
  })
  it('clamps copies together and uniformly scales relative geometry for smaller canvases', () => {
    const result = pasteSelection(objects, { width: 120, height: 95 }, 40)
    expect(selectionBounds(result)).toEqual({ x: 0, y: 0, width: 120, height: 95 })
    expect(result[1]!.x - result[0]!.x).toBe(40)
    expect(result[1]!.y - result[0]!.y).toBe(27.5)
    expect(result[2]!.width).toBe(30)
    expect(pasteSelection([], bounds, 20)).toEqual([])
  })
})
