import { isImageLayer, type AnimationGroup, type Background, type Layer } from './project'

export interface HistorySnapshot {
  background: Background | null
  layers: Layer[]
  animations: AnimationGroup[]
  selectedIds: string[]
  activeId: string | null
  addedImageCount: number
}

// Clone editable metadata only. Immutable image source strings are shared.
export function cloneSnapshot(state: HistorySnapshot): HistorySnapshot {
  return {
    background: state.background ? { ...state.background } : null,
    layers: state.layers.map(layer => isImageLayer(layer) && layer.crop ? { ...layer, crop: { ...layer.crop } } : { ...layer }),
    animations: state.animations.map(group => ({ ...group, frames: group.frames.map(frame => ({ ...frame })) })),
    selectedIds: [...state.selectedIds], activeId: state.activeId, addedImageCount: state.addedImageCount,
  }
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]))
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]))
}

export function sameDocument(a: HistorySnapshot, b: HistorySnapshot): boolean {
  return equal(a.background, b.background) && equal(a.layers, b.layers) && equal(a.animations, b.animations)
}

interface Entry { before: HistorySnapshot; after: HistorySnapshot; label: string }

export class EditHistory {
  private past: Entry[] = []
  private future: Entry[] = []
  private saved: HistorySnapshot
  constructor(initial: HistorySnapshot, private readonly limit = 50) { this.saved = cloneSnapshot(initial) }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  get undoLabel() { return this.past.at(-1)?.label ?? '' }
  get redoLabel() { return this.future.at(-1)?.label ?? '' }
  isDirty(state: HistorySnapshot) { return !sameDocument(state, this.saved) }
  markSaved(state: HistorySnapshot) { this.saved = cloneSnapshot(state) }
  reset(state: HistorySnapshot) { this.past = []; this.future = []; this.markSaved(state) }
  commit(before: HistorySnapshot, after: HistorySnapshot, label: string): boolean {
    if (sameDocument(before, after)) return false
    this.past.push({ before: cloneSnapshot(before), after: cloneSnapshot(after), label })
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
    return true
  }
  undo(): HistorySnapshot | null {
    const entry = this.past.pop()
    if (!entry) return null
    this.future.push(entry)
    return cloneSnapshot(entry.before)
  }
  redo(): HistorySnapshot | null {
    const entry = this.future.pop()
    if (!entry) return null
    this.past.push(entry)
    return cloneSnapshot(entry.after)
  }
}
