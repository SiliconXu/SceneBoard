import type { Size } from './geometry'
import { isImageLayer, type Layer, type ShapeLayer } from './project'
import { decodeImage } from './files'

export interface AnnotationOptions { coordinates: boolean; names: boolean }

export function drawShape(context: CanvasRenderingContext2D, shape: ShapeLayer) {
  context.save()
  context.strokeStyle = shape.color
  context.lineWidth = Math.min(2, shape.width, shape.height)
  const inset = context.lineWidth / 2
  const width = shape.width - inset * 2
  const height = shape.height - inset * 2
  context.beginPath()
  if (shape.kind === 'ellipse') context.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, width / 2, height / 2, 0, 0, 2 * Math.PI)
  else context.rect(shape.x + inset, shape.y + inset, width, height)
  if (shape.fillColor) {
    context.save()
    context.globalAlpha = .25
    context.fillStyle = shape.fillColor
    context.fill()
    context.restore()
  }
  context.stroke()
  context.restore()
}

// Keep annotations visible at image boundaries without changing the background resolution.
function label(context: CanvasRenderingContext2D, text: string, anchorX: number, y: number, align: 'left' | 'right' | 'center', bounds: Size, blue: boolean) {
  if (!text) return
  context.font = '14px "Segoe UI", "Microsoft YaHei", sans-serif'
  const height = Math.min(25, bounds.height)
  const width = Math.min(context.measureText(text).width + 14, bounds.width)
  const rawX = align === 'right' ? anchorX - width : align === 'center' ? anchorX - width / 2 : anchorX
  const x = Math.max(0, Math.min(bounds.width - width, rawX))
  y = Math.max(0, Math.min(bounds.height - height, y))
  context.save()
  context.fillStyle = blue ? 'rgba(83,107,221,.68)' : 'rgba(255,255,255,.65)'
  context.fillRect(x, y, width, height)
  context.beginPath(); context.rect(x, y, width, height); context.clip()
  context.fillStyle = blue ? '#ffffff' : '#40516f'
  context.textBaseline = 'middle'
  context.fillText(text, x + 7, y + height / 2)
  context.restore()
}

export function drawAnnotations(context: CanvasRenderingContext2D, layer: Layer, bounds: Size, options: AnnotationOptions) {
  const point = (x: number, y: number) => `(${Math.round(x)}, ${Math.round(y)})`
  if (options.coordinates) {
    if (isImageLayer(layer)) label(context, point(layer.x + layer.width / 2, layer.y + layer.height / 2), layer.x + layer.width / 2 + 8, layer.y + layer.height / 2 - 12.5, 'left', bounds, true)
    else {
      label(context, point(layer.x, layer.y), layer.x - 8, layer.y - 25, 'right', bounds, true)
      label(context, point(layer.x + layer.width, layer.y + layer.height), layer.x + layer.width + 8, layer.y + layer.height + 4, 'left', bounds, true)
    }
  }
  if (options.names) label(context, layer.name, layer.x + layer.width / 2, layer.y + layer.height, 'center', bounds, false)
}

export async function renderComposition(background: { src: string } & Size, layers: Layer[], options: AnnotationOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = background.width; canvas.height = background.height
  const context = canvas.getContext('2d')
  if (!context || canvas.width !== background.width || canvas.height !== background.height) throw new Error('无法创建导出画布，图片尺寸可能过大。')
  const images = await Promise.all(layers.map(layer => isImageLayer(layer) ? decodeImage(layer.src) : Promise.resolve(null)))
  context.drawImage(await decodeImage(background.src), 0, 0)
  // All names sit behind all objects, so a caption never hides another character.
  if (options.names) layers.forEach(layer => drawAnnotations(context, layer, background, { coordinates: false, names: true }))
  layers.forEach((layer, index) => {
    if (isImageLayer(layer)) context.drawImage(images[index]!, layer.x, layer.y, layer.width, layer.height)
    else drawShape(context, layer)
  })
  // Coordinates remain above the full composition.
  if (options.coordinates) layers.forEach(layer => drawAnnotations(context, layer, background, { coordinates: true, names: false }))
  return canvas
}
