import { anchorPoints, type Rect, type Size } from './geometry'

export interface Background extends Size { name: string; src: string }
interface BaseLayer extends Rect { id: string; name: string }
export interface ImageLayer extends BaseLayer { kind?: 'image'; src: string }
export interface ShapeLayer extends BaseLayer { kind: 'rectangle' | 'ellipse'; color: string; fillColor?: string | null }
export type Layer = ImageLayer | ShapeLayer
export interface Project { version: 1 | 2; background: Background; layers: Layer[] }
export const isImageLayer = (layer: Layer): layer is ImageLayer => !layer.kind || layer.kind === 'image'

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const imageSource = (value: unknown): value is string => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)

export function parseProject(text: string): Project {
  const data: unknown = JSON.parse(text)
  if (!object(data) || (data.version !== 1 && data.version !== 2)) throw new Error('项目格式或版本不受支持。')
  const bg = data.background
  if (!object(bg) || typeof bg.name !== 'string' || !imageSource(bg.src) || !positive(bg.width) || !positive(bg.height) || !Number.isInteger(bg.width) || !Number.isInteger(bg.height)) throw new Error('项目中的背景图片无效。')
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
      return { ...rect, src: layer.src, ...(layer.kind === 'image' ? { kind: 'image' as const } : {}) }
    }
    if (data.version !== 2 || (layer.kind !== 'rectangle' && layer.kind !== 'ellipse') || typeof layer.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(layer.color)) throw new Error('项目中的图形数据无效。')
    if (layer.fillColor !== undefined && layer.fillColor !== null && (typeof layer.fillColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(layer.fillColor))) throw new Error('项目中的填充颜色无效。')
    return { ...rect, kind: layer.kind, color: layer.color, ...(layer.fillColor !== undefined ? { fillColor: layer.fillColor } : {}) }
  })
  return { version: data.version, background: { name: bg.name, src: bg.src, width: bg.width, height: bg.height }, layers }
}

export function coordinateData(background: Background, layers: Layer[]) {
  return {
    background: { name: background.name, width: background.width, height: background.height },
    layers: layers.map(layer => ({
      id: layer.id, name: layer.name, kind: layer.kind ?? 'image',
      topLeft: { x: Math.round(layer.x), y: Math.round(layer.y) },
      bottomRight: { x: Math.round(layer.x + layer.width), y: Math.round(layer.y + layer.height) },
      center: { x: Math.round(layer.x + layer.width / 2), y: Math.round(layer.y + layer.height / 2) },
      ...(isImageLayer(layer) ? { anchors: Object.fromEntries(Object.entries(anchorPoints(layer)).map(([key, point]) => [key, { x: Math.round(point.x), y: Math.round(point.y) }])) } : {}),
    })),
  }
}
