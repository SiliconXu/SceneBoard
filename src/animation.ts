import type { Rect, Size } from './geometry'
import type { AnimationFrame, AnimationGroup, Layer } from './project'
import { isImageLayer } from './project'
import { resourceName, resourceNameIssue } from './resource-names'
import { decodeImage } from './files'
import { imageCanvas } from './image-processing'
import { assertCanvasSize } from './background'

export function animationSize(group: AnimationGroup): Size {
  return group.frames.reduce((size, frame) => ({ width: Math.max(size.width, frame.width), height: Math.max(size.height, frame.height) }), { width: 0, height: 0 })
}
export function framePlacement(frame: Size, size: Size): Rect {
  return { x: Math.floor((size.width - frame.width) / 2), y: Math.floor((size.height - frame.height) / 2), width: frame.width, height: frame.height }
}
export function animationFrameName(group: AnimationGroup, index: number) {
  return `${group.name}_${String(index + 1).padStart(Math.max(3, String(group.frames.length).length), '0')}`
}
export interface ResourceIssue { id: string; name: string; reason: string; target?: 'animation' }
export function analyzeResources(layers: Layer[], groups: AnimationGroup[] = []): ResourceIssue[] {
  const entries = layers.filter(isImageLayer).map(layer => ({ id: layer.id, name: layer.name, resource: resourceName(layer.name), target: undefined as 'animation' | undefined }))
  for (const group of groups) for (let i = 0; i < group.frames.length; i++) entries.push({ id: group.id, name: group.name, resource: animationFrameName(group, i), target: 'animation' })
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.resource, (counts.get(entry.resource) ?? 0) + 1)
  const issues: ResourceIssue[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    const reason = resourceNameIssue(group.name) || (!group.frames.length ? '动画组至少需要一帧。' : '')
    if (reason) { issues.push({ id: group.id, name: group.name, reason, target: 'animation' }); seen.add(group.id) }
  }
  for (const entry of entries) {
    const reason = resourceNameIssue(entry.resource) || ((counts.get(entry.resource) ?? 0) > 1 ? '去掉图片扩展名后与其他图片名称重复。' : '')
    if (reason && !seen.has(entry.id)) { issues.push({ id: entry.id, name: entry.name, reason, ...(entry.target ? { target: entry.target } : {}) }); seen.add(entry.id) }
  }
  return issues
}
export function drawAnimationFrame(context: CanvasRenderingContext2D, image: HTMLImageElement, frame: AnimationFrame, size: Size, target: Size = size) {
  const rect = framePlacement(frame, size)
  context.drawImage(image, rect.x * target.width / size.width, rect.y * target.height / size.height, rect.width * target.width / size.width, rect.height * target.height / size.height)
}
export async function buildAnimationFiles(group: AnimationGroup) {
  const size = animationSize(group)
  assertCanvasSize(size)
  const files: { path: string; bytes: Uint8Array }[] = []
  for (let i = 0; i < group.frames.length; i++) {
    const frame = group.frames[i]!, image = await decodeImage(frame.src)
    if (image.naturalWidth !== frame.width || image.naturalHeight !== frame.height) throw new Error('动画帧尺寸与图片不一致。')
    const { canvas, context } = imageCanvas(size.width, size.height)
    drawAnimationFrame(context, image, frame, size)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('动画帧导出失败。')), 'image/png'))
    files.push({ path: `images/${animationFrameName(group, i)}.png`, bytes: new Uint8Array(await blob.arrayBuffer()) })
    canvas.width = 0; canvas.height = 0
  }
  return files
}
