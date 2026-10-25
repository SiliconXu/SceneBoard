import { isImageLayer, type AnimationGroup, type Layer, type ShapeLayer } from './project'
import { type Size } from './geometry'
import { pasteSelection } from './transforms'
import { resourceName } from './resource-names'
import { animationFrameName } from './animation'

export function nextShapeName(kind: ShapeLayer['kind'], layers: Layer[], animations: AnimationGroup[] = []): string {
  const used = new Set(layers.map(layer => isImageLayer(layer) ? resourceName(layer.name) : layer.name))
  for (const group of animations) group.frames.forEach((_, index) => used.add(animationFrameName(group, index)))
  let index = 1
  while (used.has(`${kind}_${index}`)) index++
  return `${kind}_${index}`
}

export function pastedLayer(source: Layer, bounds: Size, id: string, offset: number): Layer {
  return { ...pasteSelection([source], bounds, offset)[0]!, id }
}

// The sidebar is top-to-bottom; persisted layers are bottom-to-top.
export function reorderLayers(layers: Layer[], draggedId: string, targetId: string, before: boolean): Layer[] {
  if (draggedId === targetId || !layers.some(layer => layer.id === draggedId) || !layers.some(layer => layer.id === targetId)) return layers
  const display = [...layers].reverse()
  const [dragged] = display.splice(display.findIndex(layer => layer.id === draggedId), 1)
  const targetIndex = display.findIndex(layer => layer.id === targetId)
  display.splice(targetIndex + (before ? 0 : 1), 0, dragged!)
  return display.reverse()
}
