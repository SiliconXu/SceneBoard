import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { analyzePygameProject, packPygameZip, validProjectName } from './pygame-export'
import { validCanvasSize } from './background'
import type { Background, ImageLayer } from './project'
const color: Background = { kind: 'color', name: '纯色背景', color: '#000000', width: 800, height: 600 }
const cat: ImageLayer = { id: 'cat', name: 'cat.png', src: '', x: 10.25, y: 20.6, width: 100.9, height: 50.45 }

describe('Pygame Zero project export', () => {
  it.each(['', '小猫', 'Cat', '2cat', 'my cat', 'my-cat', 'cat.py', 'cat\n', 'a'.repeat(101), 'for', 'async', 'screen', 'keyboard', 'keymods', 'exit', 'draw', 'background', 'pgzrun', 'con', 'lpt1'])('blocks unsafe or reserved name %j', name => {
    const result = analyzePygameProject(color, [{ ...cat, name }])
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.id).toBe('cat')
    expect(result.code).toBe('')
  })
  it('reports every duplicate resource stem without renaming', () => {
    const result = analyzePygameProject(color, [cat, { ...cat, id: 'copy', name: 'cat.JPG' }])
    expect(result.issues.map(issue => issue.id)).toEqual(['cat', 'copy'])
  })
  it('rounds exported centers to integers, preserves editor data and bottom-to-top order', () => {
    const result = analyzePygameProject(color, [cat, { ...cat, id: 'dog', name: 'dog' }, { id: 'shape', kind: 'ellipse', name: '不参与检查', color: '#ffffff', x: 0, y: 0, width: 10, height: 10 }])
    expect(result.issues).toEqual([])
    expect(result.code).toContain('cat.pos = (61, 46)')
    expect(cat).toMatchObject({ x: 10.25, y: 20.6, width: 100.9, height: 50.45 })
    expect(result.code).toContain("screen.fill('#000000')\n    cat.draw()\n    dog.draw()")
    expect(result.code.startsWith('import pgzrun\n')).toBe(true)
    expect(result.code.endsWith('pgzrun.go()\n')).toBe(true)
    expect(result.code).not.toContain('background')
    expect(result.code).not.toContain('update')
    expect(result.imageCount).toBe(2)
    expect(result.shapeCount).toBe(1)
  })
  it('draws an image background and supports empty scenes', () => {
    const image = analyzePygameProject({ name: '地图.webp', src: '', width: 320, height: 240 }, [])
    expect(image.code).toContain("screen.blit('background', (0, 0))")
    expect(image.code).toContain('WIDTH = 320\nHEIGHT = 240')
    expect(image.imageCount).toBe(1)
    expect(analyzePygameProject(color, []).code).toContain("def draw():\n    screen.fill('#000000')")
  })
  it('ZIP keeps the root folder and empty images directory and exact UTF-8 source', () => {
    const code = analyzePygameProject(color, []).code
    const archive = unzipSync(packPygameZip('pygame_project', [{ path: 'main.py', bytes: new TextEncoder().encode(code) }]))
    expect(Object.keys(archive)).toEqual(['pygame_project/images/', 'pygame_project/main.py'])
    expect(strFromU8(archive['pygame_project/main.py']!)).toBe(code)
  })
  it('checks canvas budgets and safe project folder names', () => {
    expect(validCanvasSize(800, 600)).toBe(true)
    for (const [w, h] of [[0, 1], [1.5, 1], [NaN, 1], [Infinity, 1], [32768, 1], [10000, 10000]]) expect(validCanvasSize(w!, h!)).toBe(false)
    for (const name of ['', '../game', 'a/b', 'a\\b', 'a.', 'a ', 'nul', 'COM1.txt']) expect(validProjectName(name)).toBe(false)
    expect(validProjectName('课堂游戏')).toBe(true)
  })
})
