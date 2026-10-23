import { decodeImage } from './files'
import type { ImageLayer } from './project'

export function imageExportInfo(layer: ImageLayer) {
  const format = /^data:image\/(png|jpeg|webp);base64,/.exec(layer.src)?.[1]
  if (!format) throw new Error('不支持此图片的导出格式。')
  const width = Math.max(1, Math.round(layer.width))
  const height = Math.max(1, Math.round(layer.height))
  const extension = format === 'jpeg' ? 'jpg' : format
  const stem = layer.name.replace(/\.(png|jpe?g|webp)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) || '对象'
  return { width, height, mime: `image/${format}`, label: format.toUpperCase(), filename: `${stem}-${width}x${height}.${extension}` }
}

export async function renderImageExport(layer: ImageLayer) {
  const info = imageExportInfo(layer)
  // Avoid allocating a canvas that is likely to exhaust the renderer's memory.
  if (!Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width > 32767 || info.height > 32767 || info.width * info.height > 64_000_000) throw new Error('导出尺寸过大，请先缩小对象。')
  const image = await decodeImage(layer.src)
  const canvas = document.createElement('canvas')
  canvas.width = info.width; canvas.height = info.height
  const context = canvas.getContext('2d')
  if (!context || canvas.width !== info.width || canvas.height !== info.height) throw new Error('无法创建导出画布，请先缩小对象。')
  // A fresh alpha-enabled canvas preserves transparent padding and soft edges.
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, info.width, info.height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片导出失败，请先缩小对象。')), info.mime, 1))
  if (blob.type !== info.mime) throw new Error(`当前环境不支持 ${info.label} 编码，无法保持原图片格式。`)
  return { blob, filename: info.filename }
}
