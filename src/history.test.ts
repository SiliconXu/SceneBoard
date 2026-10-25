import { describe, expect, it } from 'vitest'
import { cloneSnapshot, EditHistory, sameDocument, type HistorySnapshot } from './history'

const state = (): HistorySnapshot => ({
  background: { kind: 'color', name: '背景', color: '#123456', width: 800, height: 600 },
  layers: [{ id: 'hero', kind: 'image', name: 'hero', src: 'data:image/png;base64,AAAA', x: 10.25, y: 20.5, width: 100.5, height: 60.3, crop: { x: 1, y: 2, width: 10, height: 6 } }],
  animations: [{ id: 'walk', name: 'walk', fps: 10, frames: [{ id: 'f1', name: 'frame.png', src: 'data:image/png;base64,BBBB', width: 10, height: 6 }] }],
  selectedIds: ['hero'], activeId: 'hero', addedImageCount: 1,
})

describe('project edit history', () => {
  it('restores full precise documents and selection through undo and redo', () => {
    const before = state(), after = cloneSnapshot(before), history = new EditHistory(before)
    after.layers = []; after.selectedIds = []; after.activeId = null
    history.commit(before, after, '删除对象')
    expect(history.undoLabel).toBe('删除对象')
    expect(history.undo()).toEqual(before)
    expect(history.redoLabel).toBe('删除对象')
    expect(history.redo()).toEqual(after)
    expect(history.redo()).toBeNull()
  })
  it('isolates nested crop and animation metadata from subsequent edits and restoration', () => {
    const before = state(), after = cloneSnapshot(before), history = new EditHistory(before)
    after.animations[0]!.fps = 12
    history.commit(before, after, '动画素材')
    before.layers[0]!.name = 'changed'; after.animations[0]!.frames[0]!.name = 'changed'
    const restored = history.undo()!
    expect(restored.layers[0]!.name).toBe('hero')
    restored.animations[0]!.frames[0]!.name = 'also changed'
    expect(history.redo()!.animations[0]!.frames[0]!.name).toBe('frame.png')
    expect(history.undo()!.animations[0]!.frames[0]!.name).toBe('frame.png')
  })
  it('does not record selection-only changes or clear redo for no-op edits', () => {
    const before = state(), after = cloneSnapshot(before), history = new EditHistory(before)
    after.layers[0]!.x++
    history.commit(before, after, '移动'); history.undo()
    const selection = { ...before, selectedIds: [], activeId: null, addedImageCount: 5 }
    expect(history.commit(before, selection, '选择')).toBe(false)
    expect(sameDocument(before, selection)).toBe(true)
    expect(history.canRedo).toBe(true)
    expect(history.isDirty(selection)).toBe(false)
  })
  it('discards the redo branch after a new document edit', () => {
    const before = state(), after = cloneSnapshot(before), history = new EditHistory(before)
    after.layers[0]!.x++
    history.commit(before, after, '移动'); history.undo()
    after.layers[0]!.name = 'new_name'
    history.commit(before, after, '改名')
    expect(history.canRedo).toBe(false)
  })
  it('tracks the saved document independently of history position and branches', () => {
    const before = state(), saved = cloneSnapshot(before), history = new EditHistory(before)
    saved.layers[0]!.x++
    history.commit(before, saved, '移动'); history.markSaved(saved)
    expect(history.isDirty(history.undo()!)).toBe(true)
    expect(history.isDirty(history.redo()!)).toBe(false)
    const same = cloneSnapshot(saved); same.selectedIds = []
    expect(history.isDirty(same)).toBe(false)
    history.reset(before)
    expect(history.canUndo).toBe(false); expect(history.canRedo).toBe(false)
    expect(history.isDirty(before)).toBe(false)
  })
  it('keeps exactly fifty edits while preserving a saved checkpoint beyond the limit', () => {
    let current = state()
    const history = new EditHistory(current)
    for (let i = 1; i <= 60; i++) {
      const next = cloneSnapshot(current); next.layers[0]!.x = i
      history.commit(current, next, '移动'); current = next
    }
    for (let i = 0; i < 50; i++) current = history.undo()!
    expect(current.layers[0]!.x).toBe(10)
    expect(history.undo()).toBeNull()
    expect(history.isDirty(state())).toBe(false)
  })
  it('supports an empty canvas checkpoint and background replacement', () => {
    const before = { ...state(), background: null, layers: [], animations: [] }
    const history = new EditHistory(before), after = state()
    history.commit(before, after, '创建背景')
    expect(history.isDirty(after)).toBe(true)
    expect(history.isDirty(history.undo()!)).toBe(false)
    expect(history.redo()).toEqual(after)
  })
})
