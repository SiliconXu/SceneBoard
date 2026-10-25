import type { Rect, Size } from './geometry'
import type { ImageLayer } from './project'
import { assertCanvasSize } from './background'

export type ImageEdits = Pick<ImageLayer, 'crop' | 'flipX' | 'flipY'>

export function sourceRect(image: Size, edits: ImageEdits): Rect {
  const crop = edits.crop ?? { x: 0, y: 0, ...image }
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > image.width || crop.y + crop.height > image.height) throw new Error('裁剪区域超出了原始图片。')
  return crop
}

// The same crop -> flip -> scale path serves the editor, thumbnails and exports.
export function drawImageContent(context: CanvasRenderingContext2D, image: HTMLImageElement, edits: ImageEdits, target: Rect) {
  const crop = sourceRect({ width: image.naturalWidth, height: image.naturalHeight }, edits)
  let source: CanvasImageSource = image
  let cropped: HTMLCanvasElement | undefined
  // Isolate the crop at native resolution first. Scaling a source sub-rectangle
  // directly can sample discarded transparent pixels outside that rectangle.
  if (edits.crop) {
    const surface = imageCanvas(crop.width, crop.height)
    surface.context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    cropped = surface.canvas; source = cropped
  }
  context.save()
  try {
    context.translate(target.x + (edits.flipX ? target.width : 0), target.y + (edits.flipY ? target.height : 0))
    context.scale(edits.flipX ? -1 : 1, edits.flipY ? -1 : 1)
    context.drawImage(source, 0, 0, crop.width, crop.height, 0, 0, target.width, target.height)
  } finally {
    context.restore()
    if (cropped) { cropped.width = 0; cropped.height = 0 }
  }
}

export function imageCanvas(width: number, height: number) {
  assertCanvasSize({ width, height })
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context || canvas.width !== width || canvas.height !== height) throw new Error('无法创建图片画布，请先缩小图片。')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

export function alphaBounds(data: Uint8ClampedArray, width: number, height: number, noiseAlpha = 0): Rect | null {
  // Tighten each edge independently; the original aspect ratio is irrelevant.
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3]! > noiseAlpha) {
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

export function trimBoundsByAlpha(data: Uint8ClampedArray, width: number, height: number): (Rect | null)[] {
  // Scan native pixels once. Moving the tolerance slider then only selects a
  // precomputed rectangle, even for large images; source alpha stays untouched.
  const levels = Array.from({ length: 256 }, () => ({ left: width, top: height, right: -1, bottom: -1 }))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3]!
    if (!alpha) continue
    const level = levels[alpha]!
    level.left = Math.min(level.left, x); level.right = Math.max(level.right, x)
    level.top = Math.min(level.top, y); level.bottom = Math.max(level.bottom, y)
  }
  const bounds: (Rect | null)[] = Array(256).fill(null)
  let left = width, top = height, right = -1, bottom = -1
  for (let threshold = 254; threshold >= 0; threshold--) {
    const level = levels[threshold + 1]!
    left = Math.min(left, level.left); right = Math.max(right, level.right)
    top = Math.min(top, level.top); bottom = Math.max(bottom, level.bottom)
    if (right >= left) bounds[threshold] = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
  }
  return bounds
}

export function croppedLayer(layer: ImageLayer, previous: Rect, crop: Rect): ImageLayer {
  const scaleX = layer.width / previous.width, scaleY = layer.height / previous.height
  const left = layer.flipX ? previous.x + previous.width - crop.x - crop.width : crop.x - previous.x
  const top = layer.flipY ? previous.y + previous.height - crop.y - crop.height : crop.y - previous.y
  return { ...layer, crop: { ...crop }, x: layer.x + left * scaleX, y: layer.y + top * scaleY, width: crop.width * scaleX, height: crop.height * scaleY }
}
