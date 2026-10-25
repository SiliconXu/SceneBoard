import { describe, expect, it } from 'vitest'
import { alphaBounds, trimBoundsByAlpha, croppedLayer, sourceRect } from './image-processing'
import { parseProject, type ImageLayer } from './project'

describe('lossless image edits', () => {
  it('retains even a single alpha=1 pixel, excluding only alpha=0 padding', () => {
    const pixels = new Uint8ClampedArray(6 * 4 * 4)
    pixels[(1 * 6 + 2) * 4 + 3] = 1
    pixels[(2 * 6 + 4) * 4 + 3] = 128
    expect(alphaBounds(pixels, 6, 4)).toEqual({ x: 2, y: 1, width: 3, height: 2 })
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull()
  })
  it('ignores alpha=1 background-removal specks while keeping alpha=2 and soft edges', () => {
    const data = new Uint8ClampedArray(20 * 12 * 4)
    const alpha = (x: number, y: number, value: number) => { data[(y * 20 + x) * 4 + 3] = value }
    alpha(0, 0, 1); alpha(19, 11, 1)
    for (let y = 1; y <= 10; y++) for (let x = 8; x <= 10; x++) alpha(x, y, 128)
    alpha(7, 5, 2)
    const before = data.slice()
    const bounds = trimBoundsByAlpha(data, 20, 12)
    expect(bounds[1]).toEqual({ x: 7, y: 1, width: 4, height: 10 })
    expect(bounds[8]).toEqual({ x: 8, y: 1, width: 3, height: 10 })
    expect(data).toEqual(before)
  })
  it('keeps faint content at zero tolerance and reports no subject at higher cutoffs', () => {
    const data = new Uint8ClampedArray(6 * 4 * 4)
    data[(1 * 6 + 2) * 4 + 3] = 1
    data[(2 * 6 + 4) * 4 + 3] = 1
    const bounds = trimBoundsByAlpha(data, 6, 4)
    expect(bounds[0]).toEqual({ x: 2, y: 1, width: 3, height: 2 })
    expect(bounds[1]).toBeNull(); expect(bounds[8]).toBeNull()
    expect(trimBoundsByAlpha(new Uint8ClampedArray(16), 2, 2).every(box => box === null)).toBe(true)
  })
  it('precomputed cutoffs match direct alpha scans and exclude values equal to the threshold', () => {
    const data = new Uint8ClampedArray(10 * 3 * 4)
    ;[0, 1, 2, 7, 8, 9, 38, 39, 128, 255].forEach((alpha, x) => { data[(10 + x) * 4 + 3] = alpha })
    const bounds = trimBoundsByAlpha(data, 10, 3)
    expect(bounds[8]).toEqual({ x: 5, y: 1, width: 5, height: 1 })
    expect(bounds[38]).toEqual({ x: 7, y: 1, width: 3, height: 1 })
    for (let threshold = 0; threshold < 256; threshold++) expect(bounds[threshold]).toEqual(alphaBounds(data, 10, 3, threshold))
  })
  it.each([[false, false, 15.25, 23.5], [true, false, 30.25, 23.5], [false, true, 15.25, 31], [true, true, 30.25, 31]])('preserves visible position with flip (%s,%s)', (flipX, flipY, x, y) => {
    const layer: ImageLayer = { id: 'one', name: 'one', src: '', x: 10.25, y: 21, width: 50, height: 30, flipX: flipX as boolean, flipY: flipY as boolean }
    const crop = { x: 2, y: 1, width: 10, height: 7 }
    const result = croppedLayer(layer, { x: 0, y: 0, width: 20, height: 12 }, crop)
    expect(result).toMatchObject({ x, y, width: 25, height: 17.5, crop })
    expect(croppedLayer(result, crop, crop)).toEqual(result)
  })
  it('checks source bounds before rendering', () => {
    const image = { width: 10, height: 20 }
    expect(sourceRect(image, {})).toEqual({ x: 0, y: 0, ...image })
    for (const crop of [{ x: -1, y: 0, width: 1, height: 1 }, { x: 9, y: 0, width: 2, height: 1 }, { x: 0, y: 19, width: 1, height: 2 }, { x: 0.5, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }]) expect(() => sourceRect(image, { crop })).toThrow()
  })
  const project = { version: 4, background: { kind: 'color', name: 'bg', color: '#000000', width: 100, height: 100 }, layers: [{ kind: 'image', id: 'one', name: 'one', src: 'data:image/png;base64,AAAA', x: 1.25, y: 2.5, width: 10, height: 10, flipX: true, flipY: false, crop: { x: 1, y: 2, width: 4, height: 4 } }] }
  it('round trips v4 edits without modifying precise coordinates', () => {
    expect(parseProject(JSON.stringify(project))).toEqual(project)
  })
  it.each([{ flipX: 1 }, { flipY: 'true' }, { crop: null }, { crop: { x: 0, y: 0, width: 1.5, height: 2 } }])('rejects malformed edit metadata %j', invalid => {
    expect(() => parseProject(JSON.stringify({ ...project, layers: [{ ...project.layers[0], ...invalid }] }))).toThrow()
  })
})
