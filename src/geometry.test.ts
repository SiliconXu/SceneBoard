import { describe, expect, it } from 'vitest'
import { anchorPoints, drawRect, fitImage, moveRect, resizeFreeRect, resizeRect, screenToImage, type Corner } from './geometry'

describe('original-pixel geometry', () => {
  it('computes all nine rectangle anchors without rounding away precision', () => {
    expect(anchorPoints({ x: 10.5, y: 20.5, width: 101, height: 51 })).toEqual({
      topleft: { x: 10.5, y: 20.5 }, midtop: { x: 61, y: 20.5 }, topright: { x: 111.5, y: 20.5 },
      midleft: { x: 10.5, y: 46 }, center: { x: 61, y: 46 }, midright: { x: 111.5, y: 46 },
      bottomleft: { x: 10.5, y: 71.5 }, midbottom: { x: 61, y: 71.5 }, bottomright: { x: 111.5, y: 71.5 },
    })
  })
  it('fits oversized images proportionally and centers small images without upscaling', () => {
    expect(fitImage({ width: 2400, height: 1200 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 100, width: 800, height: 400 })
    expect(fitImage({ width: 200, height: 100 }, { width: 800, height: 600 })).toEqual({ x: 300, y: 250, width: 200, height: 100 })
  })
  it('converts mouse coordinates at different display scales', () => {
    expect(screenToImage({ x: 250, y: 200 }, { x: 50, y: 100 }, .5)).toEqual({ x: 400, y: 200 })
    expect(screenToImage({ x: 450, y: 300 }, { x: 50, y: 100 }, 1)).toEqual({ x: 400, y: 200 })
  })
  it('constrains movement to every background edge', () => {
    const rect = { x: 100, y: 80, width: 200, height: 100 }
    expect(moveRect(rect, { x: -500, y: -500 }, { width: 800, height: 600 })).toEqual({ ...rect, x: 0, y: 0 })
    expect(moveRect(rect, { x: 1000, y: 1000 }, { width: 800, height: 600 })).toEqual({ ...rect, x: 600, y: 500 })
  })
  it.each(['nw', 'ne', 'sw', 'se'] as Corner[])('keeps ratio and opposite corner fixed when resizing %s', corner => {
    const rect = { x: 300, y: 250, width: 200, height: 100 }
    const sx = corner.endsWith('e') ? 1 : -1
    const sy = corner.startsWith('s') ? 1 : -1
    const anchor = { x: sx === 1 ? rect.x : rect.x + rect.width, y: sy === 1 ? rect.y : rect.y + rect.height }
    const result = resizeRect(rect, corner, { x: anchor.x + sx * 300, y: anchor.y + sy * 150 }, { width: 800, height: 600 })
    expect(result.width).toBeCloseTo(300)
    expect(result.width / result.height).toBeCloseTo(2)
    expect(sx === 1 ? result.x : result.x + result.width).toBeCloseTo(anchor.x)
    expect(sy === 1 ? result.y : result.y + result.height).toBeCloseTo(anchor.y)
  })
  it.each(['nw', 'ne', 'sw', 'se'] as Corner[])('clamps an extreme resize at %s and prevents flipping', corner => {
    const rect = { x: 300, y: 250, width: 200, height: 100 }
    const sx = corner.endsWith('e') ? 1 : -1
    const sy = corner.startsWith('s') ? 1 : -1
    const result = resizeRect(rect, corner, { x: sx * 10000, y: sy * 10000 }, { width: 800, height: 600 })
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.y).toBeGreaterThanOrEqual(0)
    expect(result.x + result.width).toBeLessThanOrEqual(800)
    expect(result.y + result.height).toBeLessThanOrEqual(600)
    expect(result.width / result.height).toBeCloseTo(2)
    const reversed = resizeRect(rect, corner, { x: -sx * 10000, y: -sy * 10000 }, { width: 800, height: 600 })
    expect(reversed.width).toBe(8)
    expect(reversed.height).toBe(4)
  })
  it('resizes images smaller than the usual minimum without leaving the background', () => {
    expect(resizeRect({ x: 0, y: 0, width: 2, height: 1 }, 'se', { x: 100, y: 100 }, { width: 2, height: 1 })).toEqual({ x: 0, y: 0, width: 2, height: 1 })
  })
})

describe('shape drawing', () => {
  const bounds = { width: 800, height: 600 }
  it('defaults to equal width and height', () => {
    expect(drawRect({ x: 100, y: 100 }, { x: 250, y: 180 }, bounds, false)).toEqual({ x: 100, y: 100, width: 150, height: 150 })
  })
  it('allows rectangular dimensions with Ctrl', () => {
    expect(drawRect({ x: 100, y: 100 }, { x: 250, y: 180 }, bounds, true)).toEqual({ x: 100, y: 100, width: 150, height: 80 })
  })
  it('supports reverse drags and constrains the square to both edges', () => {
    expect(drawRect({ x: 100, y: 50 }, { x: -100, y: -100 }, bounds, false)).toEqual({ x: 50, y: 0, width: 50, height: 50 })
    expect(drawRect({ x: 100, y: 50 }, { x: -100, y: -100 }, bounds, true)).toEqual({ x: 0, y: 0, width: 100, height: 50 })
  })
  it('constrains forward drawing at the bottom and right edges', () => {
    expect(drawRect({ x: 700, y: 550 }, { x: 1000, y: 900 }, bounds, false)).toEqual({ x: 700, y: 550, width: 50, height: 50 })
  })
  it.each(['nw', 'ne', 'sw', 'se'] as Corner[])('supports free resizing at %s while fixing the opposite corner', corner => {
    const rect = { x: 300, y: 250, width: 200, height: 100 }
    const sx = corner.endsWith('e') ? 1 : -1
    const sy = corner.startsWith('s') ? 1 : -1
    const anchor = { x: sx === 1 ? rect.x : rect.x + rect.width, y: sy === 1 ? rect.y : rect.y + rect.height }
    const resized = resizeFreeRect(rect, corner, { x: anchor.x + sx * 100, y: anchor.y + sy * 80 }, bounds)
    expect(resized.width).toBe(100)
    expect(resized.height).toBe(80)
    expect(sx === 1 ? resized.x : resized.x + resized.width).toBe(anchor.x)
    expect(sy === 1 ? resized.y : resized.y + resized.height).toBe(anchor.y)
  })
})
