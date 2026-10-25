import { describe, expect, it } from 'vitest'
import { nextShapeName, pastedLayer, reorderLayers } from './layers'
import type { Layer, ShapeLayer } from './project'
import { resourceNameIssue } from './resource-names'

const layers: Layer[] = ['a', 'b', 'c'].map(id => ({ id, name: id, src: 'data:image/png;base64,AA==', x: 0, y: 0, width: 10, height: 10 }))

describe('default shape names', () => {
  const shape: ShapeLayer = { id: 'shape', kind: 'rectangle', name: 'rectangle_1', color: '#ffffff', x: 0, y: 0, width: 10, height: 10 }
  it.each(['rectangle', 'ellipse'] as const)('generates a valid pgz name for %s', kind => {
    const name = nextShapeName(kind, [])
    expect(name).toBe(`${kind}_1`)
    expect(resourceNameIssue(name)).toBe('')
  })
  it('avoids all layer names including image stems and names remaining after deletion', () => {
    const existing = [shape, { ...layers[0]!, name: 'rectangle_2.PNG' }, { ...shape, id: 'other', kind: 'ellipse' as const, name: 'rectangle_4' }]
    expect(nextShapeName('rectangle', existing)).toBe('rectangle_3')
    expect(nextShapeName('rectangle', existing.filter(layer => layer.id !== 'shape'))).toBe('rectangle_1')
    expect(existing[0]!.name).toBe('rectangle_1')
  })
  it('skips matching animation frame names', () => {
    const existing = Array.from({ length: 99 }, (_, index) => ({ ...shape, id: String(index), name: `rectangle_${index + 1}` }))
    const frame = { id: 'frame', name: 'frame.png', src: '', width: 10, height: 10 }
    expect(nextShapeName('rectangle', existing, [{ id: 'group', name: 'rectangle', fps: 10, frames: Array.from({ length: 100 }, () => frame) }])).toBe('rectangle_101')
  })
})
describe('sidebar layer ordering', () => {
  it('moves a bottom layer above the top layer', () => {
    expect(reorderLayers(layers, 'a', 'c', true).map(layer => layer.id)).toEqual(['b', 'c', 'a'])
    expect(layers.map(layer => layer.id)).toEqual(['a', 'b', 'c'])
  })
  it('moves a top layer below the bottom layer', () => {
    expect(reorderLayers(layers, 'c', 'a', false).map(layer => layer.id)).toEqual(['c', 'a', 'b'])
  })
  it('inserts between layers and keeps object data intact', () => {
    const result = reorderLayers(layers, 'a', 'b', true)
    expect(result.map(layer => layer.id)).toEqual(['b', 'a', 'c'])
    expect(result[1]).toBe(layers[0])
  })
  it('ignores self-drops and missing objects', () => {
    expect(reorderLayers(layers, 'a', 'a', true)).toBe(layers)
    expect(reorderLayers(layers, 'missing', 'a', true)).toBe(layers)
    expect(reorderLayers(layers, 'a', 'missing', true)).toBe(layers)
  })
})

describe('pasted layer geometry', () => {
  it('preserves shape styling and leaves its source untouched', () => {
    const source: Layer = { id: 'original', kind: 'ellipse', name: '目标', color: '#ef4444', fillColor: '#22c55e', x: 50, y: 60, width: 100, height: 80 }
    expect(pastedLayer(source, { width: 800, height: 600 }, 'new', 20)).toEqual({ ...source, id: 'new', x: 70, y: 80 })
    expect(source).toMatchObject({ id: 'original', x: 50, y: 60 })
  })
  it('clamps a copy to the background without distorting it', () => {
    expect(pastedLayer({ ...layers[0]!, x: 790, y: 590 }, { width: 800, height: 600 }, 'new', 40)).toMatchObject({ x: 790, y: 590, width: 10, height: 10 })
  })
  it('fits a clipboard object into a smaller replacement background', () => {
    expect(pastedLayer({ ...layers[0]!, width: 200, height: 100 }, { width: 50, height: 40 }, 'new', 0)).toMatchObject({ width: 50, height: 25, x: 0, y: 0 })
  })
})
