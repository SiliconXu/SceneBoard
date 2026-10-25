import { describe, expect, it } from 'vitest'
import { analyzeResources, animationFrameName, animationSize, framePlacement } from './animation'
import { analyzePygameProject } from './pygame-export'
import { parseProject, type AnimationGroup, type ImageLayer } from './project'

const frame = { id: 'f1', name: 'source.png', src: 'data:image/png;base64,AAAA', width: 40, height: 20 }
const group: AnimationGroup = { id: 'g1', name: 'walk', fps: 10, frames: [frame, { ...frame, id: 'f2', width: 43, height: 25 }] }
const background = { kind: 'color' as const, name: 'bg', color: '#000000', width: 100, height: 100 }
const layer: ImageLayer = { id: 'hero', name: 'hero', src: frame.src, x: 0, y: 0, width: 40, height: 20 }

describe('independent animation assets', () => {
  it('uses largest width and height and puts odd spare pixels on right and bottom', () => {
    expect(animationSize(group)).toEqual({ width: 43, height: 25 })
    expect(framePlacement(frame, animationSize(group))).toEqual({ x: 1, y: 2, width: 40, height: 20 })
  })
  it('uses sequential names, expanding every index to the same digit count', () => {
    expect(animationFrameName(group, 0)).toBe('walk_001')
    const large = { ...group, frames: Array.from({ length: 1000 }, () => frame) }
    expect(animationFrameName(large, 0)).toBe('walk_0001')
    expect(animationFrameName(large, 999)).toBe('walk_1000')
  })
  it.each(['中文', 'Walk', 'walk.png', 'for', 'animation', 'background', '../walk', 'a'.repeat(97)])('rejects invalid prefix or generated filename %j', name => {
    expect(analyzeResources([], [{ ...group, name }])).toMatchObject([{ id: group.id, target: 'animation' }])
  })
  it('locates both scene and animation resources when their output names collide', () => {
    expect(analyzeResources([{ ...layer, name: 'walk_001.webp' }], [group]).map(issue => [issue.id, issue.target])).toEqual([['hero', undefined], ['g1', 'animation']])
    expect(analyzeResources([], [group, { ...group, id: 'g2' }]).map(issue => issue.id)).toEqual(['g1', 'g2'])
  })
  it('includes frame order and FPS with opt-in playback while generating only scene actors', () => {
    const result = analyzePygameProject(background, [layer], [group])
    expect(result.issues).toEqual([]); expect(result.imageCount).toBe(3)
    expect(result.code).toContain("hero = Actor('hero')")
    expect(result.code).toContain("'walk': ['walk_001', 'walk_002']")
    expect(result.code).toContain("'walk': 10")
    expect(result.code).toContain("#     'walk': YOUR_ACTOR,")
    expect(result.code).toContain('# def update(dt):')
    expect(result.code).not.toMatch(/^def update|^walk\s*=|Actor\('walk/m)
  })
  it('supports independent FPS and single-frame groups without introducing actor variable collisions', () => {
    const result = analyzePygameProject(background, [{ ...layer, name: 'walk' }], [
      { ...group, fps: 1 }, { ...group, id: 'idle', name: 'idle', fps: 60, frames: [frame] },
    ])
    expect(result.issues).toEqual([])
    expect(result.code).toContain("walk = Actor('walk')")
    expect(result.code).toContain("'walk': 1,")
    expect(result.code).toContain("'idle': ['idle_001']")
    expect(result.code).toContain("'idle': 60,")
    expect(result.code.match(/# def update\(dt\):/g)).toHaveLength(1)
    expect(result.code).toContain('_frames[int(_animation_time * _animation_fps[_name]) % len(_frames)]')
    expect(result.code).not.toMatch(/^walk\s*=\s*\[|^idle\s*=|^def update/m)
  })
  it('uses the exported numbering even beyond 999 frames and works without a scene actor', () => {
    const large = { ...group, frames: Array.from({ length: 1000 }, () => frame) }
    const result = analyzePygameProject(background, [], [large])
    expect(result.code).toContain("'walk_0001', 'walk_0002'")
    expect(result.code).toContain("'walk_1000']")
    expect(result.code).not.toContain('Actor(')
    expect(result.imageCount).toBe(1000)
  })
  it('keeps shape names out of independent animation image export validation', () => {
    expect(analyzeResources([{ id: 'shape', kind: 'rectangle', name: '矩形 1', color: '#ffffff', x: 0, y: 0, width: 10, height: 10 }], [group])).toEqual([])
  })
  it('round trips frame order, original source, dimensions and FPS without scene layers', () => {
    const project = { version: 4, background, layers: [], animations: [group] }
    expect(parseProject(JSON.stringify(project))).toEqual(project)
    expect(parseProject(JSON.stringify({ version: 3, background, layers: [] })).animations ?? []).toEqual([])
  })
  it.each([{ fps: 0 }, { fps: 61 }, { fps: 1.5 }, { fps: '10' }, { frames: [] }, { frames: [frame, frame] }, { frames: [{ ...frame, width: 0 }] }, { frames: [{ ...frame, width: 1.5 }] }, { frames: [{ ...frame, src: 'https://example.com/a.png' }] }])('rejects corrupted animation data %j', invalid => {
    expect(() => parseProject(JSON.stringify({ version: 4, background, layers: [], animations: [{ ...group, ...invalid }] }))).toThrow()
  })
  it('rejects normalized dimensions that would exceed the pixel budget', () => {
    const frames = [{ ...frame, width: 32767, height: 1 }, { ...frame, id: 'f2', width: 1, height: 32767 }]
    expect(() => parseProject(JSON.stringify({ version: 4, background, layers: [], animations: [{ ...group, frames }] }))).toThrow('补齐后的尺寸')
  })
})
