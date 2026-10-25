import { anchorPoints, type Rect, type Size } from './geometry'
import { validCanvasSize, validColor } from './background'

export interface ImageBackground extends Size { kind?: 'image'; name: string; src: string }
export interface ColorBackground extends Size { kind: 'color'; name: string; color: string }
export type Background = ImageBackground | ColorBackground
interface BaseLayer extends Rect { id: string; name: string }
export interface ImageLayer extends BaseLayer { kind?: 'image'; src: string; flipX?: boolean; flipY?: boolean; crop?: Rect }
export interface ShapeLayer extends BaseLayer { kind: 'rectangle' | 'ellipse'; color: string; fillColor?: string | null }
export type Layer = ImageLayer | ShapeLayer
export interface AnimationFrame extends Size { id: string; name: string; src: string }
export interface AnimationGroup { id: string; name: string; fps: number; frames: AnimationFrame[] }
export interface Project { version: 1 | 2 | 3 | 4; background: Background; layers: Layer[]; animations?: AnimationGroup[] }
export const isImageLayer = (layer: Layer): layer is ImageLayer => !layer.kind || layer.kind === 'image'

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const imageSource = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)

export function parseProject(text: string): Project {
  const data: unknown = JSON.parse(text)
  if (!object(data) || (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4)) throw new Error('项目格式或版本不受支持。')
  const bg = data.background
  if (!object(bg) || typeof bg.name !== 'string' || !positive(bg.width) || !positive(bg.height) || !Number.isInteger(bg.width) || !Number.isInteger(bg.height)) throw new Error('项目中的背景尺寸无效。')
  let background: Background
  if (data.version >= 3 && bg.kind === 'color') {
    if (typeof bg.color !== 'string' || !validColor(bg.color) || !validCanvasSize(bg.width, bg.height)) throw new Error('项目中的背景颜色或尺寸无效。')
    background = { kind: 'color', name: bg.name, color: bg.color, width: bg.width, height: bg.height }
  } else {
    if ((data.version >= 3 ? bg.kind !== 'image' : bg.kind !== undefined && bg.kind !== 'image') || !imageSource(bg.src)) throw new Error('项目中的背景图片无效。')
    background = { name: bg.name, src: bg.src, width: bg.width, height: bg.height, ...(bg.kind === 'image' ? { kind: 'image' as const } : {}) }
  }
  if (!Array.isArray(data.layers)) throw new Error('项目中的图层列表无效。')
  const bounds = { width: bg.width, height: bg.height }
  const ids = new Set<string>()
  const layers = data.layers.map((layer: unknown): Layer => {
    if (!object(layer) || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id) || typeof layer.name !== 'string' || !nonnegative(layer.x) || !nonnegative(layer.y) || !positive(layer.width) || !positive(layer.height)) throw new Error('项目中的图层数据无效。')
    if (layer.x + layer.width > bounds.width + 1e-6 || layer.y + layer.height > bounds.height + 1e-6) throw new Error('项目中的图片超出了背景边界。')
    ids.add(layer.id)
    const rect = { id: layer.id, name: layer.name, x: layer.x, y: layer.y, width: layer.width, height: layer.height }
    if (layer.kind === undefined || layer.kind === 'image') {
      if (!imageSource(layer.src)) throw new Error('项目中的图片内容无效。')
      const edits: Pick<ImageLayer, 'flipX' | 'flipY' | 'crop'> = {}
      if (data.version === 4) {
        for (const key of ['flipX', 'flipY'] as const) {
          if (layer[key] !== undefined && typeof layer[key] !== 'boolean') throw new Error('项目中的翻转方向无效。')
          if (layer[key] !== undefined) edits[key] = layer[key]
        }
        if (layer.crop !== undefined) {
          const crop = layer.crop
          if (!object(crop) || !nonnegative(crop.x) || !nonnegative(crop.y) || !positive(crop.width) || !positive(crop.height) || ![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger)) throw new Error('项目中的裁剪区域无效。')
          edits.crop = { x: crop.x, y: crop.y, width: crop.width, height: crop.height }
        }
      }
      return { ...rect, src: layer.src, ...edits, ...(layer.kind === 'image' ? { kind: 'image' as const } : {}) }
    }
    if (data.version === 1 || (layer.kind !== 'rectangle' && layer.kind !== 'ellipse') || typeof layer.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(layer.color)) throw new Error('项目中的图形数据无效。')
    if (layer.fillColor !== undefined && layer.fillColor !== null && (typeof layer.fillColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(layer.fillColor))) throw new Error('项目中的填充颜色无效。')
    return { ...rect, kind: layer.kind, color: layer.color, ...(layer.fillColor !== undefined ? { fillColor: layer.fillColor } : {}) }
  })
  let animations: AnimationGroup[] | undefined
  if (data.version === 4 && data.animations !== undefined) {
    if (!Array.isArray(data.animations)) throw new Error('项目中的动画素材列表无效。')
    const takeId = (value: unknown) => {
      if (typeof value !== 'string' || !value || ids.has(value)) throw new Error('动画素材 ID 无效或重复。')
      ids.add(value); return value
    }
    animations = data.animations.map((group: unknown) => {
      if (!object(group) || typeof group.name !== 'string' || !positive(group.fps) || !Number.isInteger(group.fps) || group.fps > 60 || !Array.isArray(group.frames) || !group.frames.length) throw new Error('项目中的动画组无效（需要至少一帧及 1–60 整数 FPS）。')
      const id = takeId(group.id)
      const frames = group.frames.map((frame: unknown): AnimationFrame => {
        if (!object(frame) || typeof frame.name !== 'string' || !imageSource(frame.src) || !positive(frame.width) || !positive(frame.height) || !validCanvasSize(frame.width, frame.height)) throw new Error('项目中的动画帧无效。')
        return { id: takeId(frame.id), name: frame.name, src: frame.src, width: frame.width, height: frame.height }
      })
      const size = frames.reduce((size, frame) => ({ width: Math.max(size.width, frame.width), height: Math.max(size.height, frame.height) }), { width: 0, height: 0 })
      if (!validCanvasSize(size.width, size.height)) throw new Error('动画帧补齐后的尺寸过大。')
      return { id, name: group.name, fps: group.fps, frames }
    })
  }
  return { version: data.version, background, layers, ...(animations ? { animations } : {}) }
}

export function coordinateData(background: Background, layers: Layer[]) {
  return {
    background: { name: background.name, width: background.width, height: background.height, kind: background.kind ?? 'image', ...(background.kind === 'color' ? { color: background.color } : {}) },
    layers: layers.map(layer => ({
      id: layer.id, name: layer.name, kind: layer.kind ?? 'image',
      topLeft: { x: Math.round(layer.x), y: Math.round(layer.y) },
      bottomRight: { x: Math.round(layer.x + layer.width), y: Math.round(layer.y + layer.height) },
      center: { x: Math.round(layer.x + layer.width / 2), y: Math.round(layer.y + layer.height / 2) },
      ...(isImageLayer(layer) ? { anchors: Object.fromEntries(Object.entries(anchorPoints(layer)).map(([key, point]) => [key, { x: Math.round(point.x), y: Math.round(point.y) }])) } : {}),
    })),
  }
}
