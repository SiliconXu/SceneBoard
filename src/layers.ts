import type { Layer } from './project'
import { clamp, type Size } from './geometry'

export function pastedLayer(source: Layer, bounds: Size, id: string, offset: number): Layer {
  const scale = Math.min(1, bounds.width / source.width, bounds.height / source.height)
  const width = source.width * scale, height = source.height * scale
  return {
    ...source, id, width, height,
    x: clamp(source.x + offset, 0, bounds.width - width),
    y: clamp(source.y + offset, 0, bounds.height - height),
  }
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
