import { describe, expect, it } from 'vitest'
import { coordinateData, parseProject, type Project } from './project'

const project: Project = { version: 1, background: { name: 'bg.png', src: 'data:image/png;base64,AAAA', width: 800, height: 600 }, layers: [{ id: 'one', name: 'sprite.png', src: 'data:image/png;base64,BBBB', x: 10.25, y: 20.6, width: 100.9, height: 50.45 }] }

describe('project persistence and coordinate export', () => {
  it('round-trips all image data, precise geometry, and layer order', () => {
    const original = { ...project, layers: [...project.layers, { ...project.layers[0]!, id: 'two' }] }
    expect(parseProject(JSON.stringify(original))).toEqual(original)
  })
  it('rounds endpoints independently rather than adding rounded sizes', () => {
    expect(coordinateData(project.background, project.layers).layers[0]).toMatchObject({ id: 'one', name: 'sprite.png', kind: 'image', topLeft: { x: 10, y: 21 }, bottomRight: { x: 111, y: 71 }, center: { x: 61, y: 46 }, anchors: { midtop: { x: 61, y: 21 }, midright: { x: 111, y: 46 } } })
  })
  it.each([
    { ...project, version: 3 },
    { ...project, background: { ...project.background, width: 0 } },
    { ...project, layers: [{ ...project.layers[0], x: -1 }] },
    { ...project, layers: [{ ...project.layers[0], width: 1000 }] },
    { ...project, layers: [{ ...project.layers[0], src: 'https://example.com/image.png' }] },
    { ...project, layers: [project.layers[0], project.layers[0]] },
    { ...project, layers: [{ ...project.layers[0], height: null }] },
  ])('rejects malformed or out-of-bounds project data', invalid => {
    expect(() => parseProject(JSON.stringify(invalid))).toThrow()
  })
  it('restores version 2 shapes and custom names alongside images', () => {
    const updated: Project = { ...project, version: 2, layers: [{ ...project.layers[0]!, name: '勇者' }, { id: 'shape', name: '目标区域', kind: 'ellipse', color: '#536bdd', x: 100, y: 200, width: 140, height: 80 }] }
    expect(parseProject(JSON.stringify(updated))).toEqual(updated)
    expect(coordinateData(updated.background, updated.layers).layers[1]).toMatchObject({ name: '目标区域', kind: 'ellipse', topLeft: { x: 100, y: 200 }, bottomRight: { x: 240, y: 280 } })
  })
  it.each([
    { kind: 'triangle', color: '#536bdd' },
    { kind: 'ellipse', color: 'red' },
    { kind: 'rectangle', color: '#536bdd', width: -2 },
  ])('rejects invalid shapes', invalid => {
    const data = { ...project, version: 2, layers: [{ id: 'shape', name: 'shape', x: 0, y: 0, width: 20, height: 20, ...invalid }] }
    expect(() => parseProject(JSON.stringify(data))).toThrow()
  })
  it('does not accept shape data in legacy version 1 projects', () => {
    expect(() => parseProject(JSON.stringify({ ...project, layers: [{ id: 'shape', name: 'shape', kind: 'ellipse', color: '#536bdd', x: 0, y: 0, width: 20, height: 20 }] }))).toThrow()
  })
  it('preserves optional shape fills and rejects unsafe or invalid fill values', () => {
    const shape = { id: 'filled', name: '区域', kind: 'rectangle', color: '#ef4444', fillColor: '#22c55e', x: 0, y: 0, width: 20, height: 20 }
    const data = { ...project, version: 2, layers: [shape] }
    expect(parseProject(JSON.stringify(data))).toEqual(data)
    expect(() => parseProject(JSON.stringify({ ...data, layers: [{ ...shape, fillColor: 'red' }] }))).toThrow()
    expect(parseProject(JSON.stringify({ ...data, layers: [{ ...shape, fillColor: null }] })).layers[0]).toMatchObject({ fillColor: null })
  })
})
