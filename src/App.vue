<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { anchorPoints, clamp, drawRect, fitImage, moveRect, resizeFreeRect, resizeRect, screenToImage, type Corner, type Point, type Rect } from './geometry'
import { coordinateData, isImageLayer, parseProject, type Background, type ImageLayer, type Layer, type Project, type ShapeLayer, type AnimationGroup } from './project'
import { decodeImage, download, downloadJson, readImage } from './files'
import { renderComposition } from './render'
import { imageExportInfo, renderImageExport } from './image-export'
import ShapeView from './ShapeView.vue'
import ImageContent from './ImageContent.vue'
import CropDialog from './CropDialog.vue'
import AnimationDialog from './AnimationDialog.vue'
import { sourceRect } from './image-processing'
import EditableName from './EditableName.vue'
import DistanceGuides from './DistanceGuides.vue'
import { proximityGuides, type Guides } from './guides'
import { nextShapeName, reorderLayers } from './layers'
import SelectionProperties from './SelectionProperties.vue'
import { alignSelection, containedBy, distributeSelection, editRect, moveSelection, pasteSelection, positionAt, selectionBounds, type Alignment, type Axis, type PositionAnchor, type RectField } from './transforms'
import logoUrl from './logo.png'
import ColorBackgroundDialog from './ColorBackgroundDialog.vue'
import PygameExportDialog from './PygameExportDialog.vue'
import type { ColorBackground } from './project'
import { cloneSnapshot, EditHistory, type HistorySnapshot } from './history'

const background = ref<Background | null>(null)
const showBackgroundMenu = ref(false)
const colorDialog = ref<'create' | 'edit' | null>(null)
const exportSnapshot = ref<Project | null>(null)
const currentColorBackground = computed(() => colorDialog.value === 'edit' && background.value?.kind === 'color' ? background.value : undefined)
const cropSnapshot = ref<ImageLayer | null>(null)
const animations = ref<AnimationGroup[]>([])
const animationsOpen = ref(false)
const animationInitialId = ref<string>()
const modalOpen = computed(() => !!colorDialog.value || !!exportSnapshot.value || !!cropSnapshot.value || animationsOpen.value || confirmReplace.value)
const layers = ref<Layer[]>([])
const selectedIds = ref<string[]>([])
const activeId = ref<string | null>(null)
// Assigning a single ID also replaces the selection (open/import/rename/export).
const selectedId = computed({ get: () => activeId.value, set: (id: string | null) => setSelection(id ? [id] : [], id) })
const selectedLayers = computed(() => layers.value.filter(layer => selectedIds.value.includes(layer.id)))
const selected = computed(() => selectedLayers.value.length === 1 ? selectedLayers.value[0] : undefined)
const selectionBox = computed(() => selectionBounds(selectedLayers.value))
function setSelection(ids: string[], active: string | null = ids.at(-1) ?? null) {
  flushNudge()
  selectedIds.value = ids
  activeId.value = active && ids.includes(active) ? active : ids.at(-1) ?? null
  guides.value = null; guideMode.value = null
}
function isSelected(id: string) { return selectedIds.value.includes(id) }
function additive(event?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) { return !!event && (event.shiftKey || event.ctrlKey || event.metaKey) }
function toggleSelection(id: string) {
  setSelection(isSelected(id) ? selectedIds.value.filter(item => item !== id) : [...selectedIds.value, id], id)
}
function applyRects(rects: Layer[]) {
  let changed = false
  for (const rect of rects) {
    const layer = layers.value.find(item => item.id === rect.id)
    if (layer && (layer.x !== rect.x || layer.y !== rect.y || layer.width !== rect.width || layer.height !== rect.height)) {
      Object.assign(layer, rect); changed = true
    }
  }
  if (changed) dirty.value = true
}
function updateSelectionGuides() {
  const box = selectionBox.value
  guides.value = box ? proximityGuides({ ...box, id: '__selection__' }, layers.value.filter(layer => !isSelected(layer.id)), scale.value) : null
}
function editSelection(field: RectField, value: number, anchor: PositionAnchor, proportional: boolean) {
  if (!background.value || !selectionBox.value || busy.value) return
  const bounds = background.value, box = selectionBox.value
  endGesture()
  editProject('修改位置与尺寸', () => {
    try {
      if (selected.value) {
        const result = editRect(selected.value, field, value, bounds, anchor, proportional)
        applyRects([{ ...selected.value, ...result }])
        const actual = field === 'x' || field === 'y' ? positionAt(result, anchor)[field] : result[field]
        if (Math.abs(actual - value) > 1e-7) notify('已按画布边界限制，显示实际数值')
      } else if (field === 'x' || field === 'y') {
        const point = positionAt(box, anchor)
        const delta = { x: field === 'x' ? value - point.x : 0, y: field === 'y' ? value - point.y : 0 }
        applyRects(moveSelection(selectedLayers.value, delta, bounds))
        if (Math.abs(positionAt(selectionBox.value!, anchor)[field] - value) > 1e-7) notify('已按画布边界限制，显示实际数值')
      }
    } catch (error) { notify(errorText(error), true) }
  })
}
function arrangeSelection(alignment: Alignment) { if (!busy.value) editProject('对齐对象', () => applyRects(alignSelection(selectedLayers.value, alignment))) }
function flipSelection(axis: 'flipX' | 'flipY') {
  if (busy.value) return
  endGesture()
  editProject('翻转图片', () => {
    for (const layer of selectedLayers.value.filter(isImageLayer)) layer[axis] = !layer[axis]
  })
}
function openCrop() {
  if (!selectedImage.value || busy.value) return
  cancelDrawing(); endGesture(); endMarquee(); endPan(); closeObjectMenu()
  cropSnapshot.value = JSON.parse(JSON.stringify(selectedImage.value))
}
function applyCrop(result: ImageLayer) {
  const layer = layers.value.find(item => item.id === result.id)
  if (layer && isImageLayer(layer)) editProject('裁剪透明留白', () => { Object.assign(layer, result); guides.value = null; guideMode.value = null })
  cropSnapshot.value = null
}
function openAnimations(id?: string) {
  if (!background.value || busy.value) return
  cancelDrawing(); endGesture(); endMarquee(); endPan(); closeObjectMenu()
  animationInitialId.value = id; animationsOpen.value = true
}
function applyAnimations(groups: AnimationGroup[]) {
  editProject('修改动画素材', () => { animations.value = groups })
  animationsOpen.value = false
}
function distribute(axis: Axis) {
  if (busy.value) return
  endGesture()
  const result = distributeSelection(selectedLayers.value, axis)
  if (result) editProject('等间距分布', () => applyRects(result))
}
const bgInput = ref<HTMLInputElement>()
const layerInput = ref<HTMLInputElement>()
const projectInput = ref<HTMLInputElement>()
const workspace = ref<HTMLElement>()
const stage = ref<HTMLElement>()
const layerList = ref<HTMLElement>()
const scale = ref(1)
const zoom = ref(1)
const pan = ref<Point>({ x: 0, y: 0 })
const panning = ref(false)
const spacePressed = ref(false)
let panGesture: { pointerId: number; button: number; start: Point; origin: Point } | null = null
const message = ref('')
const isError = ref(false)
const busy = ref(false)
const showExport = ref(false)
const objectMenu = ref<{ id: string; x: number; y: number } | null>(null)
const objectMenuElement = ref<HTMLElement>()
let objectMenuOrigin: HTMLElement | null = null
const selectedImage = computed(() => selected.value && isImageLayer(selected.value) ? selected.value : null)
const selectedExportInfo = computed(() => selectedImage.value ? imageExportInfo(selectedImage.value) : null)
const contextImage = computed(() => {
  const layer = layers.value.find(item => item.id === objectMenu.value?.id)
  return layer && isImageLayer(layer) ? layer : null
})
const contextExportInfo = computed(() => contextImage.value ? imageExportInfo(contextImage.value) : null)
const confirmReplace = ref(false)
const dirty = ref(false)
const tool = ref<'select' | 'rectangle' | 'ellipse'>('select')
const draft = ref<ShapeLayer | null>(null)
const shiftPressed = ref(false)
const ctrlPressed = ref(false)
const drawingHint = computed(() => {
  if (tool.value !== 'select') return shiftPressed.value ? `Shift：绘制${tool.value === 'rectangle' ? '正方形' : '圆形'}` : `按住 Shift 绘制${tool.value === 'rectangle' ? '正方形' : '圆形'}`
  if (selected.value && !isImageLayer(selected.value)) return shiftPressed.value ? 'Shift：缩放为正方形 / 圆形' : ctrlPressed.value ? 'Ctrl：自由调整图形宽高' : '图形缩放：默认等比，Shift 正方形 / 圆形，Ctrl 自由宽高'
  if (selectedImage.value) return '图片保持比例缩放'
  return '默认绘制矩形 / 椭圆，按住 Shift 绘制正方形 / 圆形'
})
const exportCoordinatesOption = ref(false)
const exportNamesOption = ref(false)
const defaultBorder = ref('#536bdd')
const defaultFill = ref<string | null>(null)
const draggedLayerId = ref<string | null>(null)
const dropTarget = ref<{ id: string; before: boolean } | null>(null)
const layerClipboard = ref<{ layers: Layer[]; cut: boolean; pasteCount: number } | null>(null)
const editingLayerId = ref<string | null>(null)
const guides = ref<Guides | null>(null)
const guideMode = ref<'drag' | 'keyboard' | null>(null)
const hasGuides = computed(() => !!guides.value && (guides.value.measurements.length > 0 || guides.value.alignments.length > 0))
const palette = [
  { name: '蓝色', value: '#536bdd' }, { name: '红色', value: '#ef4444' },
  { name: '橙色', value: '#f59e0b' }, { name: '绿色', value: '#22c55e' },
  { name: '青色', value: '#06b6d4' }, { name: '紫色', value: '#a855f7' },
]
const selectedShape = computed(() => selected.value && !isImageLayer(selected.value) ? selected.value : null)
const borderColor = computed(() => selectedShape.value?.color ?? defaultBorder.value)
const fillColor = computed(() => selectedShape.value ? selectedShape.value.fillColor ?? null : defaultFill.value)
let pendingBackground: Background | null = null
let addedImageCount = 0
let observer: ResizeObserver | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined
const corners: Corner[] = ['nw', 'ne', 'sw', 'se']
const cornerLabels = { nw: '左上角', ne: '右上角', sw: '左下角', se: '右下角' }
const stageStyle = computed(() => background.value ? { width: `${background.value.width * scale.value}px`, height: `${background.value.height * scale.value}px`, transform: `translate(${pan.value.x}px, ${pan.value.y}px)`, backgroundColor: background.value.kind === 'color' ? background.value.color : undefined, backgroundImage: background.value.kind === 'color' ? 'none' : undefined } : {})

function captureHistory(): HistorySnapshot {
  return cloneSnapshot({ background: background.value, layers: layers.value, animations: animations.value, selectedIds: selectedIds.value, activeId: activeId.value, addedImageCount })
}
const history = new EditHistory(captureHistory())
const historyRevision = ref(0)
const canUndo = computed(() => { historyRevision.value; return history.canUndo })
const canRedo = computed(() => { historyRevision.value; return history.canRedo })
const undoTitle = computed(() => { historyRevision.value; return `撤销${history.undoLabel ? `：${history.undoLabel}` : ''}（Ctrl+Z / Command+Z）` })
const redoTitle = computed(() => { historyRevision.value; return `重做${history.redoLabel ? `：${history.redoLabel}` : ''}（Ctrl+Y / Ctrl+Shift+Z / Command+Shift+Z）` })
let nudge: { before: HistorySnapshot; keys: Set<string> } | null = null
function syncHistory() { historyRevision.value++; dirty.value = history.isDirty(captureHistory()) }
function commitEdit(before: HistorySnapshot, label: string) { history.commit(before, captureHistory(), label); syncHistory() }
function flushNudge() {
  const current = nudge
  nudge = null
  if (current) commitEdit(current.before, '微调位置')
}
function editProject(label: string, action: () => void) {
  endGesture(); flushNudge()
  const before = captureHistory()
  try { action() } finally { commitEdit(before, label) }
}
async function restoreHistory(redo = false) {
  if (busy.value || modalOpen.value) return
  commitFocusedInput()
  cancelDrawing(); endGesture(); flushNudge(); endMarquee(); endPan(); endLayerDrag(); closeObjectMenu()
  const snapshot = redo ? history.redo() : history.undo()
  if (!snapshot) return
  const dimensionsChanged = background.value?.width !== snapshot.background?.width || background.value?.height !== snapshot.background?.height
  background.value = snapshot.background
  layers.value = snapshot.layers
  animations.value = snapshot.animations
  addedImageCount = snapshot.addedImageCount
  tool.value = 'select'; spacePressed.value = false
  setSelection(snapshot.selectedIds.filter(id => layers.value.some(layer => layer.id === id)), snapshot.activeId)
  showExport.value = false; showBackgroundMenu.value = false
  syncHistory()
  await nextTick()
  if (dimensionsChanged) fitStage(true)
  else constrainPan()
  if (activeId.value) void revealLayerCard(activeId.value)
}

function notify(text: string, error = false) {
  message.value = text
  isError.value = error
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { message.value = '' }, error ? 8000 : 3500)
}

function fitStage(reset = false) {
  if (!workspace.value || !background.value) return
  if (reset) { endPan(); zoom.value = 1; pan.value = { x: 0, y: 0 } }
  scale.value = Math.max(0.00001, Math.min(1, (workspace.value.clientWidth - 100) / background.value.width, (workspace.value.clientHeight - 100) / background.value.height)) * zoom.value
  constrainPan()
}

function constrainPan() {
  if (!workspace.value || !background.value) return
  const limitX = Math.max(0, (background.value.width * scale.value - workspace.value.clientWidth) / 2)
  const limitY = Math.max(0, (background.value.height * scale.value - workspace.value.clientHeight) / 2)
  pan.value = { x: clamp(pan.value.x, -limitX, limitX), y: clamp(pan.value.y, -limitY, limitY) }
}

function zoomMap(event: WheelEvent) {
  if (!background.value || !workspace.value || busy.value) return
  event.preventDefault()
  if (gesture || drawing || panGesture || marquee) return
  const box = workspace.value.getBoundingClientRect()
  const anchor = { x: event.clientX - box.left - workspace.value.clientLeft - workspace.value.clientWidth / 2, y: event.clientY - box.top - workspace.value.clientTop - workspace.value.clientHeight / 2 }
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? workspace.value.clientHeight : 1)
  const nextZoom = clamp(zoom.value * Math.exp(-clamp(delta, -500, 500) * .002), .25, 16)
  const ratio = nextZoom / zoom.value
  pan.value = { x: anchor.x - (anchor.x - pan.value.x) * ratio, y: anchor.y - (anchor.y - pan.value.y) * ratio }
  zoom.value = nextZoom
  scale.value *= ratio
  constrainPan()
  guides.value = null; guideMode.value = null
}

function beginPan(event: PointerEvent) {
  if ((event.button !== 1 && !(event.button === 0 && spacePressed.value)) || !background.value || !workspace.value) return
  if ((event.target as HTMLElement).closest('.drawing-tools')) return
  event.preventDefault(); event.stopPropagation()
  if (busy.value || gesture || drawing || marquee) return
  const canPan = background.value.width * scale.value > workspace.value.clientWidth || background.value.height * scale.value > workspace.value.clientHeight
  if (!canPan) return
  panGesture = { pointerId: event.pointerId, button: event.button, start: { x: event.clientX, y: event.clientY }, origin: { ...pan.value } }
  panning.value = true
  guides.value = null; guideMode.value = null
  workspace.value.setPointerCapture(event.pointerId)
}

function updatePan(event: PointerEvent) {
  if (!panGesture || event.pointerId !== panGesture.pointerId) return
  event.preventDefault(); event.stopPropagation()
  if (!(event.buttons & (panGesture.button === 0 ? 1 : 4))) { endPan(); return }
  pan.value = { x: panGesture.origin.x + event.clientX - panGesture.start.x, y: panGesture.origin.y + event.clientY - panGesture.start.y }
  constrainPan()
}

function endPan(event?: PointerEvent) {
  if (!panGesture || (event && event.pointerId !== panGesture.pointerId)) return
  const current = panGesture
  panGesture = null; panning.value = false
  if (workspace.value?.hasPointerCapture(current.pointerId)) workspace.value.releasePointerCapture(current.pointerId)
}

function preventPanMouseDefault(event: MouseEvent) {
  if (event.button === 1 || (event.button === 0 && spacePressed.value)) event.preventDefault()
}

function onPanKeydown(event: KeyboardEvent) {
  if (event.code !== 'Space' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !background.value || busy.value || modalOpen.value || confirmReplace.value || objectMenu.value) return
  const target = event.target as HTMLElement
  if (target?.isContentEditable || target?.closest('input, textarea, select')) return
  // Preserve keyboard activation outside the canvas, unless the pointer is over it.
  if (target?.closest('button, a, [role="button"]') && !workspace.value?.contains(target) && !workspace.value?.matches(':hover')) return
  event.preventDefault(); event.stopPropagation()
  spacePressed.value = true
}

function onPanKeyup(event: KeyboardEvent) {
  if (event.code !== 'Space' || !spacePressed.value) return
  event.preventDefault(); event.stopPropagation()
  spacePressed.value = false
  if (panGesture?.button === 0) endPan()
}

async function applyBackground(bg: Background) {
  cancelDrawing()
  endGesture()
  endMarquee()
  tool.value = 'select'
  editProject(background.value ? '替换背景' : '创建背景', () => {
    background.value = bg
    addedImageCount = 0
    layers.value = []
    selectedId.value = null
  })
  await nextTick()
  fitStage(true)
}

async function loadBackground(event: Event) {
  showBackgroundMenu.value = false
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  try {
    const bg = await readImage(file)
    if (background.value) {
      pendingBackground = bg
      confirmReplace.value = true
    } else await applyBackground(bg)
  } catch (error) { notify(errorText(error), true) }
  finally { busy.value = false }
}

function cancelReplace() { pendingBackground = null; confirmReplace.value = false }
function openColorDialog(mode: 'create' | 'edit') {
  showBackgroundMenu.value = false
  cancelDrawing(); endGesture(); endMarquee(); endPan(); closeObjectMenu()
  colorDialog.value = mode
}
async function applyColorBackground(bg: ColorBackground) {
  if (colorDialog.value === 'edit' && background.value?.kind === 'color') {
    editProject('修改背景颜色', () => { background.value = bg })
  } else if (background.value) { pendingBackground = bg; confirmReplace.value = true }
  else await applyBackground(bg)
  colorDialog.value = null
}
function openPygameExport() {
  if (!background.value || busy.value) return
  cancelDrawing(); endGesture(); endMarquee(); endPan(); closeObjectMenu()
  showExport.value = false
  exportSnapshot.value = JSON.parse(JSON.stringify({ version: 4, background: background.value, layers: layers.value, animations: animations.value }))
}
async function locateExportIssue(id: string, target?: 'animation') {
  exportSnapshot.value = null
  if (target === 'animation') { openAnimations(id); return }
  chooseLayer(id)
  await nextTick()
  const card = Array.from(layerList.value?.querySelectorAll<HTMLElement>('[data-card-id]') ?? []).find(item => item.dataset.cardId === id)
  card?.scrollIntoView({ block: 'nearest' })
  card?.querySelector<HTMLButtonElement>('[data-testid="edit-name"]')?.click()
}
function pygameSaved(path: string) { exportSnapshot.value = null; notify(`Pygame Zero 项目已导出：${path}`) }
async function replaceBackground() {
  const bg = pendingBackground
  cancelReplace()
  if (bg) await applyBackground(bg)
}

async function addLayers(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || !background.value) return
  busy.value = true
  try {
    // Read the entire batch first, so a failed file does not partially change the project.
    const images = await Promise.all(files.map(readImage))
    const additions: ImageLayer[] = images.map((image, index) => ({
      kind: 'image', id: crypto.randomUUID(), name: image.name, src: image.src,
      ...moveRect(fitImage(image, background.value!), { x: (addedImageCount + index) * 20, y: (addedImageCount + index) * 20 }, background.value!),
    }))
    editProject('添加图片', () => {
      addedImageCount += additions.length
      layers.value.push(...additions)
      selectedId.value = additions.at(-1)!.id
    })
    notify(`已添加 ${additions.length} 张图片`)
  } catch (error) { notify(errorText(error), true) }
  finally { busy.value = false }
}

function removeLayer(id: string) {
  if (busy.value) return
  const index = layers.value.findIndex(layer => layer.id === id)
  if (index < 0) return
  endGesture()
  editProject('删除对象', () => {
    layers.value.splice(index, 1)
    if (isSelected(id)) {
      const remaining = selectedIds.value.filter(item => item !== id)
      const fallback = layers.value[Math.min(index, layers.value.length - 1)]?.id
      setSelection(remaining.length ? remaining : fallback ? [fallback] : [])
    }
  })
}
function removeSelected() {
  if (busy.value || !selectedLayers.value.length) return
  endGesture()
  editProject('删除所选对象', () => {
    layers.value = layers.value.filter(layer => !isSelected(layer.id))
    setSelection([])
  })
}

function copyLayer(cut = false) {
  if (!selectedLayers.value.length || busy.value) return
  endGesture()
  layerClipboard.value = { layers: selectedLayers.value.map(layer => ({ ...layer })), cut, pasteCount: 0 }
  if (cut) removeSelected()
  notify(cut ? '图层已剪切，可粘贴到当前项目' : '图层已复制')
}

function pasteLayer() {
  if (!layerClipboard.value || !background.value || busy.value) return
  const clipboard = layerClipboard.value
  const offset = 20 * (clipboard.pasteCount + (clipboard.cut ? 0 : 1))
  const additions = pasteSelection(clipboard.layers, background.value, offset).map(layer => ({ ...layer, id: crypto.randomUUID() }))
  selectTool('select'); endLayerDrag()
  editProject('粘贴对象', () => {
    layers.value.push(...additions)
    setSelection(additions.map(layer => layer.id))
    clipboard.pasteCount++
  })
  notify('图层已粘贴')
}

function startLayerDrag(event: DragEvent, id: string) {
  closeObjectMenu()
  if (busy.value || (event.target as HTMLElement).closest('.layer-delete')) { event.preventDefault(); return }
  cancelDrawing(); endGesture()
  draggedLayerId.value = id
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }
}
function previewLayerDrop(event: DragEvent, id: string) {
  if (!draggedLayerId.value || draggedLayerId.value === id || busy.value) { dropTarget.value = null; return }
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { id, before: event.clientY < box.top + box.height / 2 }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function endLayerDrag() { draggedLayerId.value = null; dropTarget.value = null }
function dropLayer(event: DragEvent, id: string) {
  previewLayerDrop(event, id)
  if (draggedLayerId.value && dropTarget.value && !busy.value) {
    editProject('调整图层顺序', () => { layers.value = reorderLayers(layers.value, draggedLayerId.value!, id, dropTarget.value!.before) })
  }
  endLayerDrag()
}

function renameLayer(id: string, name: string) {
  const layer = layers.value.find(item => item.id === id)
  if (!layer || busy.value) return
  editProject('修改名称', () => { layer.name = name })
}
function setNameEditing(id: string, active: boolean) {
  if (active) editingLayerId.value = id
  else if (editingLayerId.value === id) editingLayerId.value = null
}

interface Gesture { id: string; pointerId: number; target: HTMLElement; start: Point; last: Point; rect: Rect; rects: Layer[]; before: HistorySnapshot; corner?: Corner; scale: number; origin: Point; collapse: boolean; moved: boolean }
let gesture: Gesture | null = null
function selectCanvasLayer(id: string, event?: KeyboardEvent) {
  if (busy.value) return
  if (additive(event)) toggleSelection(id)
  else selectedId.value = id
  void revealLayerCard(id)
}

async function revealLayerCard(id: string) {
  // Selection expands image details, so measure after Vue updates the card.
  await nextTick()
  const list = layerList.value
  if (!list || selectedId.value !== id) return
  const card = Array.from(list.children).find(element => (element as HTMLElement).dataset.cardId === id) as HTMLElement | undefined
  if (!card) return
  const listBox = list.getBoundingClientRect(), cardBox = card.getBoundingClientRect()
  const top = listBox.top + list.clientTop, bottom = top + list.clientHeight
  if (cardBox.height > list.clientHeight || cardBox.top < top) list.scrollTop += cardBox.top - top
  else if (cardBox.bottom > bottom) list.scrollTop += cardBox.bottom - bottom
}

function beginGesture(event: PointerEvent, layer: Layer, corner?: Corner) {
  if (tool.value !== 'select') { beginDrawing(event); return }
  if (busy.value || event.button !== 0 || !stage.value || gesture) return
  commitFocusedInput()
  flushNudge()
  guides.value = null
  guideMode.value = null
  event.preventDefault()
  if (additive(event) && !corner) {
    toggleSelection(layer.id)
    void revealLayerCard(layer.id)
    return
  }
  const collapse = isSelected(layer.id) && selectedLayers.value.length > 1 && !corner
  if (!isSelected(layer.id) || corner) selectedId.value = layer.id
  else activeId.value = layer.id
  void revealLayerCard(layer.id)
  const target = event.currentTarget as HTMLElement
  const bounds = stage.value.getBoundingClientRect()
  const origin = { x: bounds.left, y: bounds.top }
  const point = screenToImage({ x: event.clientX, y: event.clientY }, origin, scale.value)
  const handleCorner = corner ? { x: corner.endsWith('e') ? layer.x + layer.width : layer.x, y: corner.startsWith('s') ? layer.y + layer.height : layer.y } : point
  // Account for clicking slightly off the exact corner, preventing a jump at drag start.
  shiftPressed.value = event.shiftKey; ctrlPressed.value = event.ctrlKey
  gesture = { before: captureHistory(), rects: selectedLayers.value.map(item => ({ ...item })), collapse, moved: false, id: layer.id, pointerId: event.pointerId, target, start: { x: point.x - handleCorner.x, y: point.y - handleCorner.y }, last: point, rect: { x: layer.x, y: layer.y, width: layer.width, height: layer.height }, corner, scale: scale.value, origin }
  if (!corner) gesture.start = point
  target.setPointerCapture(event.pointerId)
}

function refreshResize() {
  if (!gesture?.corner || !gesture.moved || !background.value) return
  const layer = layers.value.find(item => item.id === gesture!.id)
  if (!layer) return
  const point = { x: gesture.last.x - gesture.start.x, y: gesture.last.y - gesture.start.y }
  const shape = !isImageLayer(layer)
  const result = shape && ctrlPressed.value && !shiftPressed.value
    ? resizeFreeRect(gesture.rect, gesture.corner, point, background.value)
    : resizeRect(gesture.rect, gesture.corner, point, background.value, shape && shiftPressed.value)
  applyRects([{ ...layer, ...result }])
  guides.value = null
}

function updateGesture(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId || !background.value) return
  const layer = layers.value.find(item => item.id === gesture!.id)
  if (!layer) return
  const point = screenToImage({ x: event.clientX, y: event.clientY }, gesture.origin, gesture.scale)
  gesture.last = point
  shiftPressed.value = event.shiftKey; ctrlPressed.value = event.ctrlKey
  const distance = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) * gesture.scale
  if (!gesture.corner && !gesture.moved && distance < 3) return
  gesture.moved = true
  if (gesture.corner) {
    refreshResize()
  } else {
    applyRects(moveSelection(gesture.rects, { x: point.x - gesture.start.x, y: point.y - gesture.start.y }, background.value))
    updateSelectionGuides()
  }
  guideMode.value = 'drag'
}

function finishGesture(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  if (gesture.corner && gesture.moved) updateGesture(event)
  const collapse = gesture.collapse && !gesture.moved
  const id = gesture.id
  endGesture()
  if (collapse) selectedId.value = id
}

function endGesture() {
  guides.value = null
  guideMode.value = null
  const current = gesture
  gesture = null
  if (current) commitEdit(current.before, current.corner ? '缩放对象' : '移动对象')
  if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
}

interface Marquee { pointerId: number; target: HTMLElement; start: Point; origin: Point; scale: number; base: string[]; previous: string[]; active: string | null; moved: boolean }
let marquee: Marquee | null = null
const marqueeBox = ref<Rect | null>(null)
function commitFocusedInput() {
  const input = document.activeElement
  if (input instanceof HTMLElement && input.closest('.selection-properties, .inline-name')) input.blur()
}
function beginMarquee(event: PointerEvent) {
  if (event.button !== 0 || busy.value || !stage.value || !background.value || gesture || marquee) return
  commitFocusedInput()
  event.preventDefault()
  const bounds = stage.value.getBoundingClientRect()
  const origin = { x: bounds.left, y: bounds.top }
  const previous = [...selectedIds.value]
  marquee = { pointerId: event.pointerId, target: stage.value, start: screenToImage({ x: event.clientX, y: event.clientY }, origin, scale.value), origin, scale: scale.value, base: additive(event) ? previous : [], previous, active: activeId.value, moved: false }
  stage.value.setPointerCapture(event.pointerId)
}
function updateMarquee(event: PointerEvent) {
  if (!marquee || event.pointerId !== marquee.pointerId || !background.value) return
  const point = screenToImage({ x: event.clientX, y: event.clientY }, marquee.origin, marquee.scale)
  if (!marquee.moved && Math.hypot(point.x - marquee.start.x, point.y - marquee.start.y) * marquee.scale < 3) return
  marquee.moved = true
  const box = drawRect(marquee.start, point, background.value)
  marqueeBox.value = box
  setSelection([...new Set([...marquee.base, ...layers.value.filter(layer => containedBy(layer, box)).map(layer => layer.id)])])
}
function endMarquee(cancel = true) {
  const current = marquee
  if (!current) return
  marquee = null; marqueeBox.value = null
  if (cancel) setSelection(current.previous, current.active)
  else if (!current.moved) setSelection(current.base)
  if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
}
function finishMarquee(event: PointerEvent) {
  if (!marquee || event.pointerId !== marquee.pointerId) return
  updateMarquee(event); endMarquee(false)
}

interface Drawing { pointerId: number; target: HTMLElement; start: Point; last: Point; scale: number; origin: Point }
let drawing: Drawing | null = null

function selectTool(value: typeof tool.value) {
  cancelDrawing(); endGesture(); flushNudge(); endMarquee()
  tool.value = value
  if (value !== 'select') selectedId.value = null
}

function beginDrawing(event: PointerEvent) {
  if (event.button !== 0) return
  if (tool.value === 'select') { beginMarquee(event); return }
  if (busy.value || event.button !== 0 || !stage.value || !background.value || drawing) return
  event.preventDefault()
  const box = stage.value.getBoundingClientRect()
  const origin = { x: box.left, y: box.top }
  const raw = screenToImage({ x: event.clientX, y: event.clientY }, origin, scale.value)
  const start = { x: clamp(raw.x, 0, background.value.width), y: clamp(raw.y, 0, background.value.height) }
  selectedId.value = null
  shiftPressed.value = event.shiftKey
  ctrlPressed.value = event.ctrlKey
  draft.value = { id: crypto.randomUUID(), kind: tool.value, color: defaultBorder.value, fillColor: defaultFill.value, name: '', ...drawRect(start, start, background.value, event.shiftKey) }
  drawing = { pointerId: event.pointerId, target: stage.value, start, last: start, scale: scale.value, origin }
  stage.value.setPointerCapture(event.pointerId)
}

function refreshDrawing() {
  if (drawing && draft.value && background.value) Object.assign(draft.value, drawRect(drawing.start, drawing.last, background.value, shiftPressed.value))
}

function updateDrawing(event: PointerEvent) {
  if (!drawing || drawing.pointerId !== event.pointerId) return
  drawing.last = screenToImage({ x: event.clientX, y: event.clientY }, drawing.origin, drawing.scale)
  shiftPressed.value = event.shiftKey
  ctrlPressed.value = event.ctrlKey
  refreshDrawing()
}

function cancelDrawing() {
  const current = drawing
  drawing = null
  draft.value = null
  if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
}

function finishDrawing(event: PointerEvent) {
  if (!drawing || drawing.pointerId !== event.pointerId) return
  updateDrawing(event)
  const shape = draft.value
  cancelDrawing()
  if (!shape || shape.width < 1 || shape.height < 1) return
  editProject('绘制图形', () => {
    shape.name = nextShapeName(shape.kind, layers.value, animations.value)
    layers.value.push(shape)
    selectedId.value = shape.id
  })
  tool.value = 'select'
}

function setShapeColor(property: 'color' | 'fillColor', value: string | null) {
  if (busy.value) return
  if (property === 'color' && value) defaultBorder.value = value
  if (property === 'fillColor') defaultFill.value = value
  const shape = selectedShape.value
  if (shape) {
    editProject('修改图形颜色', () => {
      if (property === 'color' && value) shape.color = value
      if (property === 'fillColor') shape.fillColor = value
    })
  }
  if (draft.value) {
    if (property === 'color' && value) draft.value.color = value
    if (property === 'fillColor') draft.value.fillColor = value
  }
}

function chooseLayer(id: string, event?: MouseEvent | KeyboardEvent) {
  if (busy.value) return
  selectTool('select')
  if (additive(event)) toggleSelection(id)
  else selectedId.value = id
}

const round = (value: number) => Math.round(value)
const formatPoint = (x: number, y: number) => `(${round(x)}, ${round(y)})`
const layerStyle = (layer: Rect, index: number) => ({ left: `${layer.x * scale.value}px`, top: `${layer.y * scale.value}px`, width: `${layer.width * scale.value}px`, height: `${layer.height * scale.value}px`, zIndex: index + 1 })
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'
const fileStem = () => (background.value?.name.replace(/\.[^.]+$/, '') || 'frame')

function closeObjectMenu() { objectMenu.value = null }

async function openObjectMenu(event: MouseEvent, layer: Layer) {
  if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
  event.preventDefault()
  closeObjectMenu()
  if (busy.value || !isImageLayer(layer)) return
  chooseLayer(layer.id)
  showExport.value = false
  objectMenuOrigin = event.currentTarget as HTMLElement
  objectMenu.value = { id: layer.id, x: event.clientX, y: event.clientY }
  await nextTick()
  const box = objectMenuElement.value?.getBoundingClientRect()
  if (!box || !objectMenu.value) return
  objectMenu.value.x = Math.max(8, Math.min(event.clientX, window.innerWidth - box.width - 8))
  objectMenu.value.y = Math.max(8, Math.min(event.clientY, window.innerHeight - box.height - 8))
  objectMenuElement.value?.querySelector('button')?.focus({ preventScroll: true })
}

function dismissObjectMenu(event: PointerEvent) {
  if (!(event.target as HTMLElement).closest('.object-export-menu')) closeObjectMenu()
}

async function exportObject(layer: ImageLayer | null) {
  if (!layer || busy.value) return
  const snapshot = { ...layer }
  showExport.value = false
  closeObjectMenu()
  busy.value = true
  try {
    const { blob, filename } = await renderImageExport(snapshot)
    if (await download(blob, filename)) notify('对象图片已导出')
  } catch (error) { notify(errorText(error), true) }
  finally { busy.value = false }
}

async function exportCoordinates() {
  if (!background.value) return
  showExport.value = false
  try {
    if (await downloadJson(coordinateData(background.value, layers.value), `${fileStem()}-coordinates.json`)) notify('坐标 JSON 已导出')
  } catch (error) { notify(errorText(error), true) }
}

async function copyCoordinates() {
  if (!background.value) return
  try {
    const text = JSON.stringify(coordinateData(background.value, layers.value), null, 2)
    if (window.sceneBoardDesktop) await window.sceneBoardDesktop.copyText(text)
    else await navigator.clipboard.writeText(text)
    notify('坐标 JSON 已复制')
  } catch { notify('复制失败，请使用“导出坐标 JSON”保存。', true) }
  showExport.value = false
}

async function saveProject() {
  if (!background.value || busy.value) return
  commitFocusedInput(); endGesture(); flushNudge()
  const saved = captureHistory()
  const bg: Background = background.value.kind === 'color' ? { ...background.value } : { ...background.value, kind: 'image' }
  const project: Project = { version: 4, background: bg, layers: layers.value, animations: animations.value }
  busy.value = true
  try {
    if (await downloadJson(project, `${fileStem()}.frame.json`)) {
      history.markSaved(saved); syncHistory()
      notify('项目已保存，包含所有图片和精确坐标')
    }
  } catch (error) { notify(errorText(error), true) }
  finally { busy.value = false }
}

async function openProject(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  try {
    const project = parseProject(await file.text())
    const images = await Promise.all([project.background.kind === 'color' ? Promise.resolve(null) : decodeImage(project.background.src), ...project.layers.map(layer => isImageLayer(layer) ? decodeImage(layer.src) : Promise.resolve(null))])
    const bg = images[0]!
    if (project.background.kind !== 'color' && (!bg || bg.naturalWidth !== project.background.width || bg.naturalHeight !== project.background.height)) throw new Error('项目背景尺寸与图片不一致。')
    project.layers.forEach((layer, index) => {
      if (!isImageLayer(layer)) return
      const image = images[index + 1]!
      const content = sourceRect({ width: image.naturalWidth, height: image.naturalHeight }, layer)
      const ratio = content.width / content.height
      if (Math.abs(layer.width / layer.height - ratio) / ratio > 1e-6) throw new Error('项目中的图片宽高比例无效。')
    })
    await Promise.all((project.animations ?? []).flatMap(group => group.frames.map(async frame => {
      const image = await decodeImage(frame.src)
      if (image.naturalWidth !== frame.width || image.naturalHeight !== frame.height) throw new Error('动画帧尺寸与图片不一致。')
    })))
    if (dirty.value && background.value && !window.confirm('当前项目有未保存的更改。打开新项目会替换当前内容，是否继续？')) return
    cancelDrawing(); endGesture(); flushNudge(); endMarquee(); endPan(); tool.value = 'select'
    background.value = project.background
    layers.value = project.layers
    animations.value = project.animations ?? []
    addedImageCount = project.layers.filter(isImageLayer).length
    selectedId.value = project.layers.at(-1)?.id ?? null
    history.reset(captureHistory()); syncHistory()
    await nextTick()
    fitStage(true)
    notify('项目已恢复')
  } catch (error) { notify(`打开项目失败：${errorText(error)}`, true) }
  finally { busy.value = false }
}

async function exportPng() {
  if (!background.value) return
  showExport.value = false
  busy.value = true
  try {
    const bg = background.value
    const canvas = await renderComposition(bg, layers.value, { coordinates: exportCoordinatesOption.value, names: exportNamesOption.value })
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 导出失败，图片尺寸可能过大。')), 'image/png'))
    if (await download(blob, `${fileStem()}-composition.png`)) notify('合成 PNG 已导出')
  } catch (error) { notify(errorText(error), true) }
  finally { busy.value = false }
}

function onKeydown(event: KeyboardEvent) {
  if (modalOpen.value) return
  if (objectMenu.value) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      closeObjectMenu()
      if (event.key === 'Escape') { event.preventDefault(); objectMenuOrigin?.focus({ preventScroll: true }) }
      return
    }
    if (!['Enter', ' '].includes(event.key)) { event.preventDefault(); return }
  }
  shiftPressed.value = event.shiftKey
  ctrlPressed.value = event.ctrlKey
  if (event.key === 'Shift' || event.key === 'Control') { refreshDrawing(); refreshResize() }
  if (confirmReplace.value) { if (event.key === 'Escape') cancelReplace(); return }
  const target = event.target as HTMLElement
  if (event.isComposing || target?.isContentEditable || target?.closest('input, textarea, select')) return
  const key = event.key.toLowerCase()
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
    event.preventDefault()
    if (!event.repeat) void restoreHistory(key === 'y' || event.shiftKey)
    return
  }
  if (event.key === 'Escape') { cancelDrawing(); endGesture(); endMarquee(); endPan(); tool.value = 'select'; selectedId.value = null; showExport.value = false; showBackgroundMenu.value = false }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !event.altKey && background.value && !busy.value) {
    event.preventDefault(); selectTool('select'); setSelection(layers.value.map(layer => layer.id)); return
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selectedLayers.value.length && background.value && !busy.value && tool.value === 'select' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    endGesture()
    if (!nudge) nudge = { before: captureHistory(), keys: new Set() }
    nudge.keys.add(event.key)
    const step = event.shiftKey ? 10 : 1
    applyRects(moveSelection(selectedLayers.value, { x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0 }, background.value))
    updateSelectionGuides()
    guideMode.value = 'keyboard'
    return
  }
  if (key === 'a' && background.value && !busy.value && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    if (!event.repeat) layerInput.value?.click()
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && ['c', 'x', 'v'].includes(key)) {
    const available = key === 'v' ? background.value && layerClipboard.value : selectedLayers.value.length
    if (!available || busy.value) return
    event.preventDefault()
    if (!event.repeat) { if (key === 'v') pasteLayer(); else copyLayer(key === 'x') }
    return
  }
  if (background.value && !busy.value && !event.ctrlKey && !event.metaKey && !event.altKey && ['1', '2', '3'].includes(event.key)) {
    event.preventDefault()
    selectTool(event.key === '1' ? 'select' : event.key === '2' ? 'rectangle' : 'ellipse')
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLayers.value.length) { event.preventDefault(); removeSelected() }
}
function onKeyup(event: KeyboardEvent) {
  if (nudge?.keys.delete(event.key) && !nudge.keys.size) flushNudge()
  shiftPressed.value = event.shiftKey; ctrlPressed.value = event.ctrlKey
  if (event.key === 'Shift' || event.key === 'Control') { refreshDrawing(); refreshResize() }
}
function onBlur() { closeObjectMenu(); shiftPressed.value = false; ctrlPressed.value = false; spacePressed.value = false; cancelDrawing(); endGesture(); flushNudge(); endMarquee(); endPan() }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value && background.value) { event.preventDefault(); event.returnValue = '' } }
function closeExport(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.export-wrap')) showExport.value = false
  if (!(event.target as HTMLElement).closest('.background-wrap')) showBackgroundMenu.value = false
}

onMounted(() => {
  observer = new ResizeObserver(() => { closeObjectMenu(); cancelDrawing(); endGesture(); endMarquee(); endPan(); fitStage() })
  if (workspace.value) observer.observe(workspace.value)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('keydown', onPanKeydown, true)
  window.addEventListener('keyup', onPanKeyup, true)
  window.addEventListener('blur', onBlur)
  window.addEventListener('beforeunload', beforeUnload)
  document.addEventListener('click', closeExport)
  document.addEventListener('pointerdown', dismissObjectMenu)
  document.addEventListener('scroll', closeObjectMenu, true)
})
onBeforeUnmount(() => {
  cancelDrawing(); endGesture(); endMarquee(); endPan(); observer?.disconnect(); clearTimeout(toastTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('keydown', onPanKeydown, true)
  window.removeEventListener('keyup', onPanKeyup, true)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('beforeunload', beforeUnload)
  document.removeEventListener('click', closeExport)
  document.removeEventListener('pointerdown', dismissObjectMenu)
  document.removeEventListener('scroll', closeObjectMenu, true)
})
</script>

<template>
  <div class="app-shell" :aria-busy="busy">
    <header class="topbar" :inert="modalOpen">
      <div class="brand"><img class="brand-logo" :src="logoUrl" alt="瓦肯青少年编程 VULCODING" /></div>
      <div class="toolbar">
        <button class="button" :disabled="busy" @click="projectInput?.click()"><span class="button-icon">↗</span>打开项目</button>
        <span class="toolbar-divider"></span>
        <div class="background-wrap">
          <button class="button" :disabled="busy" :aria-expanded="showBackgroundMenu" @click="showBackgroundMenu = !showBackgroundMenu"><span class="button-icon">▧</span>{{ background ? '替换背景' : '加载背景' }}<span>⌄</span></button>
          <div v-if="showBackgroundMenu" class="export-menu">
            <button @click="bgInput?.click()">加载背景图片</button>
            <button @click="openColorDialog('create')">创建纯色背景</button>
          </div>
        </div>
        <button class="button" aria-keyshortcuts="a" title="添加图片（A）" :disabled="!background || busy" @click="layerInput?.click()"><span class="button-icon">＋</span>添加图片 <kbd>A</kbd></button>
        <button class="button" :disabled="!background || busy" @click="saveProject"><span class="button-icon">▣</span>保存项目<span v-if="dirty && background" class="unsaved-dot" title="有未保存更改"></span></button>
        <div class="export-wrap">
          <button class="button primary" aria-label="导出" :disabled="!background || busy" :aria-expanded="showExport" @click="showExport = !showExport">导出<span class="chevron" aria-hidden="true">⌄</span></button>
          <div v-if="showExport" class="export-menu">
            <button class="object-export-action" @click="openPygameExport">导出 Pygame Zero 项目…</button>
            <button class="object-export-action" :disabled="!selectedImage || busy" @click="exportObject(selectedImage)">导出选中对象…<small v-if="selectedExportInfo">{{ selectedExportInfo.width }} × {{ selectedExportInfo.height }} px · {{ selectedExportInfo.label }}</small><small v-else>请先选择角色或物品图片</small></button>
            <div class="export-options"><strong>PNG 标注选项</strong><label><input v-model="exportCoordinatesOption" type="checkbox" />包含坐标</label><label><input v-model="exportNamesOption" type="checkbox" />包含名称</label><small>应用于所有图片和图形</small></div>
            <button @click="exportPng">合成图片 <span>PNG</span></button>
            <button @click="exportCoordinates">导出坐标 <span>JSON</span></button>
            <button @click="copyCoordinates">复制坐标 <span>剪贴板</span></button>
          </div>
        </div>
      </div>
      <input ref="bgInput" data-testid="background-input" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="loadBackground" />
      <input ref="layerInput" data-testid="layer-input" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="addLayers" />
      <input ref="projectInput" data-testid="project-input" type="file" accept=".json,application/json" hidden @change="openProject" />
    </header>

    <main class="main-layout" :inert="modalOpen">
      <section class="editor-panel" aria-label="图片编辑区">
        <div class="editor-heading"><div><span class="section-kicker">WORKSPACE</span><h1>{{ background ? background.name : '让每个位置，都有坐标。' }}</h1></div><div class="workspace-actions"><div class="history-controls" role="group" aria-label="编辑历史"><button aria-label="撤销" aria-keyshortcuts="Control+Z Meta+Z" :title="undoTitle" :disabled="busy || modalOpen || !canUndo" @click="restoreHistory()">↶</button><button aria-label="重做" aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z" :title="redoTitle" :disabled="busy || modalOpen || !canRedo" @click="restoreHistory(true)">↷</button></div><span class="local-badge"><i></i>本地处理</span></div></div>
        <div ref="workspace" class="workspace" :class="{ 'has-background': background, drawing: tool !== 'select', 'pan-ready': spacePressed, panning }" @wheel="zoomMap" @mousedown.capture="preventPanMouseDefault" @auxclick="preventPanMouseDefault" @pointerdown.capture="beginPan" @pointermove.capture="updatePan" @pointerup.capture="endPan" @pointercancel="endPan" @lostpointercapture="endPan" @pointerdown.self="!busy && $event.button === 0 && (selectedId = null)">
          <div v-if="background" class="drawing-tools" aria-label="绘图工具"><button aria-label="选择工具" aria-keyshortcuts="1" :aria-pressed="tool === 'select'" :disabled="busy" @click="selectTool('select')">↖ 选择 <kbd>1</kbd></button><button aria-label="绘制矩形" aria-keyshortcuts="2" :aria-pressed="tool === 'rectangle'" :disabled="busy" @click="selectTool('rectangle')">▭ 矩形 <kbd>2</kbd></button><button aria-label="绘制椭圆" aria-keyshortcuts="3" :aria-pressed="tool === 'ellipse'" :disabled="busy" @click="selectTool('ellipse')">⬭ 椭圆 <kbd>3</kbd></button><span :title="drawingHint">{{ drawingHint }}</span></div>
          <div v-if="!background" class="empty-workspace">
            <div class="empty-art" aria-hidden="true"><div class="art-back"></div><div class="art-front"><svg viewBox="0 0 80 60" fill="none"><circle cx="57" cy="17" r="6" fill="currentColor"/><path d="M10 48 29 26l15 17 10-11 17 16H10Z" fill="currentColor"/></svg></div><span class="art-cross">＋</span><span class="art-corner"></span></div>
            <span class="empty-kicker">YOUR CANVAS STARTS HERE</span>
            <h2>先选择一种背景</h2>
            <p>添加角色与物品，自由摆放、等比例缩放。<br />每一处位置，都能实时读取原图坐标。</p>
            <button class="button primary load-button" :disabled="busy" @click="bgInput?.click()"><span>＋</span>加载背景图片</button>
            <button class="button solid-start" :disabled="busy" @click="openColorDialog('create')">创建纯色背景</button>
            <span class="file-note">PNG / JPEG / WebP · 图片仅在本机处理</span>
            <div class="workflow"><span><b>01</b>设置背景</span><i>→</i><span><b>02</b>摆放图片</span><i>→</i><span><b>03</b>导出成果</span></div>
          </div>
          <div v-else ref="stage" class="stage" :style="stageStyle" data-testid="stage" @pointerdown="beginDrawing" @pointermove="updateDrawing($event); updateMarquee($event)" @pointerup="finishDrawing($event); finishMarquee($event)" @pointercancel="cancelDrawing(); endMarquee()" @lostpointercapture="cancelDrawing(); endMarquee()">
            <img v-if="background.kind !== 'color'" class="background-image" :src="background.src" :alt="background.name" draggable="false" />
            <span class="origin-label">0, 0</span>
            <div v-for="(layer, index) in layers" :key="layer.id" class="image-layer" :class="{ selected: isSelected(layer.id) }" :style="layerStyle(layer, index)" :data-layer-id="layer.id" data-testid="image-layer" role="button" tabindex="0" :aria-label="`选择 ${layer.name}`" :aria-pressed="isSelected(layer.id)" @keydown.enter.self="selectCanvasLayer(layer.id, $event)" @keydown.space.self.prevent="selectCanvasLayer(layer.id, $event)" @pointerdown.stop="beginGesture($event, layer)" @pointermove="updateGesture" @pointerup="finishGesture" @pointercancel="endGesture" @lostpointercapture="endGesture">
              <ImageContent v-if="isImageLayer(layer)" :layer="layer" />
              <ShapeView v-else :shape="layer" />
              <template v-if="selected?.id === layer.id">
                <button v-for="corner in corners" :key="corner" class="resize-handle" :class="corner" :data-testid="`resize-${corner}`" :aria-label="`从${cornerLabels[corner]}缩放`" :title="isImageLayer(layer) ? '图片保持比例缩放' : '默认等比缩放；Shift 正方形 / 圆形；Ctrl 自由宽高（Shift 优先）'" @pointerdown.stop="beginGesture($event, layer, corner)"></button>
              </template>
            </div>
            <div v-if="selectionBox && selectedLayers.length > 1" class="group-selection" :style="{ ...layerStyle(selectionBox, layers.length + 1) }" data-testid="group-selection"></div>
            <div v-if="marqueeBox" class="marquee-selection" :style="layerStyle(marqueeBox, layers.length + 5)" data-testid="marquee-selection"></div>
            <div v-if="draft" class="shape-preview" :style="layerStyle(draft, layers.length)"><ShapeView :shape="draft" /></div>
            <DistanceGuides v-if="hasGuides && guides" :guides="guides" :scale="scale" :style="{ zIndex: layers.length + 4 }" />
            <div class="annotation-overlay name-overlay" :style="{ zIndex: 0 }"><div v-for="(layer, index) in layers" :key="layer.id" class="annotation-box" :style="layerStyle(layer, index)"><span v-if="layer.name && selected?.id === layer.id && !hasGuides" class="object-name" data-testid="object-name">{{ layer.name }}</span></div></div>
            <div v-if="selected && (!hasGuides || guideMode === 'keyboard')" class="annotation-overlay coordinate-overlay" :style="{ zIndex: layers.length + 3 }"><div class="annotation-box" :style="layerStyle(selected, 0)"><template v-if="isImageLayer(selected)"><i class="center-marker"></i><span class="selection-tag center-tag" data-testid="center-label">{{ formatPoint(selected.x + selected.width / 2, selected.y + selected.height / 2) }}</span></template><template v-else><span class="selection-tag" data-testid="top-left-label">{{ formatPoint(selected.x, selected.y) }}</span><span class="selection-tag bottom-tag" data-testid="bottom-right-label">{{ formatPoint(selected.x + selected.width, selected.y + selected.height) }}</span></template></div></div>
          </div>
        </div>
        <div v-if="background" class="properties-dock" role="region" aria-label="画布属性栏">
          <SelectionProperties v-if="selectedLayers.length && tool === 'select'" :layers="selectedLayers" :disabled="busy" @edit="editSelection" @align="arrangeSelection" @distribute="distribute" @flip="flipSelection" @crop="openCrop" />
          <p v-else class="selection-empty">选择对象后可编辑位置与尺寸，多选后可对齐和分布。</p>
        </div>
        <div class="editor-footer"><span><span class="hint-icon">⌖</span>{{ background ? '拖动对象 · 四角缩放 · 滚轮缩放地图 · 空格＋左键 / 中键拖动地图' : '原点位于背景左上角，横轴向右，纵轴向下' }}</span><span class="zoom-readout">{{ background ? `${round(background.width)} × ${round(background.height)} px · ${Math.round(scale * 100)}%` : '坐标单位：原图像素' }} <button v-if="background" class="fit-map" :disabled="busy" @click="cancelDrawing(); endGesture(); fitStage(true)">适应窗口</button></span></div>
      </section>

      <aside class="sidebar">
        <div class="sidebar-title"><h2>对象图层</h2><button class="text-button animation-entry" :disabled="!background || busy" @click="openAnimations()">动画素材…<small v-if="animations.length">{{ animations.length }} 组</small></button></div>
        <p class="sidebar-description">Shift / Ctrl 点击多选，空白处拖动框选；拖曳卡片排序。</p>
        <div ref="layerList" class="layer-list" @dragend="endLayerDrag" @dragleave.self="dropTarget = null">
          <div v-if="!layers.length" class="empty-layers"><span class="stack-icon">▱<br />▱</span><strong>还没有添加图片</strong><p>{{ background ? '添加角色或物品，开始摆放。' : '设置背景后，在这里管理图片。' }}</p><button v-if="background" class="text-button" :disabled="busy" @click="layerInput?.click()">＋ 添加第一张图片</button></div>
          <div v-for="(layer, index) in [...layers].reverse()" :key="layer.id" class="layer-card" :class="{ active: isSelected(layer.id), dragging: draggedLayerId === layer.id, 'drop-before': dropTarget?.id === layer.id && dropTarget.before, 'drop-after': dropTarget?.id === layer.id && !dropTarget.before }" role="button" tabindex="0" :aria-label="`选择图层 ${layer.name || '未命名对象'}`" :aria-pressed="isSelected(layer.id)" :draggable="!busy && editingLayerId !== layer.id" :data-card-id="layer.id" data-testid="layer-card" @contextmenu="openObjectMenu($event, layer)" @click="chooseLayer(layer.id, $event)" @keydown.enter.self="chooseLayer(layer.id, $event)" @keydown.space.self.prevent="chooseLayer(layer.id, $event)" @dragstart="startLayerDrag($event, layer.id)" @dragover.prevent="previewLayerDrop($event, layer.id)" @drop.stop.prevent="dropLayer($event, layer.id)">
            <button class="layer-delete" :aria-label="`删除${isImageLayer(layer) ? '图片' : '图形'}`" :title="`删除 ${layer.name || '未命名对象'}`" :disabled="busy" draggable="false" @click.stop="removeLayer(layer.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" /></svg></button>
            <div class="layer-card-header"><span class="layer-number" data-testid="layer-number" :title="`图层顺序 ${index + 1}`">{{ index + 1 }}</span><div class="thumbnail"><ImageContent v-if="isImageLayer(layer)" :layer="layer" thumbnail /><span v-else class="shape-thumbnail" :class="layer.kind" :style="{ borderColor: layer.color, backgroundColor: layer.fillColor ? `${layer.fillColor}40` : 'transparent' }"></span></div><div class="layer-name"><EditableName :name="layer.name" :disabled="busy" @select="chooseLayer(layer.id)" @rename="renameLayer(layer.id, $event)" @editing="setNameEditing(layer.id, $event)" /><small>{{ round(layer.width) }} × {{ round(layer.height) }} px</small></div></div>
            <div class="layer-coordinates"><span>左上角 <b>{{ formatPoint(layer.x, layer.y) }}</b></span><span>中心点 <b>{{ formatPoint(layer.x + layer.width / 2, layer.y + layer.height / 2) }}</b></span><span>右下角 <b>{{ formatPoint(layer.x + layer.width, layer.y + layer.height) }}</b></span></div>
            <details v-if="isImageLayer(layer)" class="anchor-details" @pointerdown.stop @dragstart.stop.prevent>
              <summary @click.stop>锚点坐标</summary>
              <div class="anchor-grid" data-testid="anchor-grid"><span v-for="(point, key) in anchorPoints(layer)" :key="key"><small>{{ key }}</small><b>{{ formatPoint(point.x, point.y) }}</b></span></div>
            </details>
          </div>
        </div>
        <section v-if="selectedShape || tool !== 'select'" class="shape-colors" aria-label="图形颜色"><div><strong>边框颜色</strong><div class="color-swatches"><button v-for="color in palette" :key="color.value" :aria-label="`边框${color.name}`" :aria-pressed="borderColor === color.value" :disabled="busy" :style="{ background: color.value }" @click="setShapeColor('color', color.value)"></button></div></div><div><strong>填充颜色 <small>25% 不透明度</small></strong><div class="color-swatches"><button class="no-fill" aria-label="无填充" :aria-pressed="!fillColor" :disabled="busy" @click="setShapeColor('fillColor', null)">∅</button><button v-for="color in palette" :key="color.value" :aria-label="`填充${color.name}`" :aria-pressed="fillColor === color.value" :disabled="busy" :style="{ background: color.value }" @click="setShapeColor('fillColor', color.value)"></button></div></div></section>
        <div v-if="background" class="background-info"><span>{{ background.kind === 'color' ? '纯色背景' : '背景图片' }}</span><strong :title="background.name">{{ background.kind === 'color' ? background.color : background.name }}</strong><small>{{ background.width }} × {{ background.height }} px</small><button v-if="background.kind === 'color'" class="text-button" :disabled="busy" @click="openColorDialog('edit')">修改背景颜色</button></div>
      </aside>
    </main>
    <footer class="app-footer" :inert="modalOpen"><span>VULCODING / IMAGE COORDINATE STUDIO</span><span>本机编辑，精确定位。<i></i>无需上传</span></footer>
    <div v-if="objectMenu && contextImage && contextExportInfo" ref="objectMenuElement" class="object-export-menu" role="menu" aria-label="图片对象操作" :style="{ left: `${objectMenu.x}px`, top: `${objectMenu.y}px` }" @contextmenu.prevent>
      <button role="menuitem" :disabled="busy" @click="exportObject(contextImage)">导出此对象…<small>{{ contextExportInfo.width }} × {{ contextExportInfo.height }} px · {{ contextExportInfo.label }}</small></button>
    </div>
    <div v-if="busy" class="busy-indicator" role="status">正在处理图片…</div>
    <div v-if="message" class="toast" :class="{ error: isError }" role="status"><span>{{ isError ? '!' : '✓' }}</span>{{ message }}<button aria-label="关闭提示" @click="message = ''">×</button></div>
    <ColorBackgroundDialog v-if="colorDialog" :current="currentColorBackground" @close="colorDialog = null" @apply="applyColorBackground" />
    <CropDialog v-if="cropSnapshot" :layer="cropSnapshot" @close="cropSnapshot = null" @apply="applyCrop" />
    <AnimationDialog v-if="animationsOpen" :groups="animations" :layers="layers" :initial-id="animationInitialId" @close="animationsOpen = false" @apply="applyAnimations" />
    <PygameExportDialog v-if="exportSnapshot" :project="exportSnapshot" @close="exportSnapshot = null" @locate="locateExportIssue" @saved="pygameSaved" />
    <div v-if="confirmReplace" class="modal-backdrop" @click.self="cancelReplace">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="replace-title"><span class="section-kicker">REPLACE BACKGROUND</span><h2 id="replace-title">替换背景？</h2><p>替换后将清空当前 {{ layers.length }} 个图层。需要保留时，请先取消并保存项目。</p><div class="modal-actions"><button class="button" autofocus @click="cancelReplace">取消</button><button class="button primary" @click="replaceBackground">替换并清空</button></div></section>
    </div>
  </div>
</template>
