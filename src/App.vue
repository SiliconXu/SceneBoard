<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { anchorPoints, clamp, drawRect, fitImage, moveRect, resizeFreeRect, resizeRect, screenToImage, type Corner, type Point, type Rect } from './geometry'
import { coordinateData, isImageLayer, parseProject, type Background, type ImageLayer, type Layer, type Project, type ShapeLayer } from './project'
import { decodeImage, download, downloadJson, readImage } from './files'
import { renderComposition } from './render'
import ShapeView from './ShapeView.vue'
import EditableName from './EditableName.vue'
import DistanceGuides from './DistanceGuides.vue'
import { proximityGuides, type Guides } from './guides'
import { pastedLayer, reorderLayers } from './layers'
import logoUrl from './logo.png'

const background = ref<Background | null>(null)
const layers = ref<Layer[]>([])
const selectedId = ref<string | null>(null)
const selected = computed(() => layers.value.find(layer => layer.id === selectedId.value))
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
let panGesture: { pointerId: number; start: Point; origin: Point } | null = null
const message = ref('')
const isError = ref(false)
const busy = ref(false)
const showExport = ref(false)
const confirmReplace = ref(false)
const dirty = ref(false)
const tool = ref<'select' | 'rectangle' | 'ellipse'>('select')
const draft = ref<ShapeLayer | null>(null)
const ctrlPressed = ref(false)
const exportCoordinatesOption = ref(false)
const exportNamesOption = ref(false)
const defaultBorder = ref('#536bdd')
const defaultFill = ref<string | null>(null)
const draggedLayerId = ref<string | null>(null)
const dropTarget = ref<{ id: string; before: boolean } | null>(null)
const layerClipboard = ref<{ layer: Layer; cut: boolean; pasteCount: number } | null>(null)
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
const stageStyle = computed(() => background.value ? { width: `${background.value.width * scale.value}px`, height: `${background.value.height * scale.value}px`, transform: `translate(${pan.value.x}px, ${pan.value.y}px)` } : {})

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
  if (gesture || drawing || panGesture) return
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
  if (event.button !== 2 || !background.value || !workspace.value) return
  event.preventDefault(); event.stopPropagation()
  if (busy.value || gesture || drawing) return
  const canPan = background.value.width * scale.value > workspace.value.clientWidth || background.value.height * scale.value > workspace.value.clientHeight
  if (!canPan) return
  panGesture = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { ...pan.value } }
  panning.value = true
  guides.value = null; guideMode.value = null
  workspace.value.setPointerCapture(event.pointerId)
}

function updatePan(event: PointerEvent) {
  if (!panGesture || event.pointerId !== panGesture.pointerId) return
  event.preventDefault(); event.stopPropagation()
  pan.value = { x: panGesture.origin.x + event.clientX - panGesture.start.x, y: panGesture.origin.y + event.clientY - panGesture.start.y }
  constrainPan()
}

function endPan(event?: PointerEvent) {
  if (!panGesture || (event && event.pointerId !== panGesture.pointerId)) return
  const current = panGesture
  panGesture = null; panning.value = false
  if (workspace.value?.hasPointerCapture(current.pointerId)) workspace.value.releasePointerCapture(current.pointerId)
}

async function applyBackground(bg: Background) {
  cancelDrawing()
  endGesture()
  tool.value = 'select'
  background.value = bg
  addedImageCount = 0
  layers.value = []
  selectedId.value = null
  dirty.value = true
  await nextTick()
  fitStage(true)
}

async function loadBackground(event: Event) {
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
    addedImageCount += additions.length
    layers.value.push(...additions)
    selectedId.value = additions.at(-1)!.id
    dirty.value = true
    notify(`已添加 ${additions.length} 张图片`)
  } catch (error) { notify(errorText(error), true) }
  finally { busy.value = false }
}

function removeLayer(id: string) {
  if (busy.value) return
  const index = layers.value.findIndex(layer => layer.id === id)
  if (index < 0) return
  endGesture()
  layers.value.splice(index, 1)
  if (selectedId.value === id) selectedId.value = layers.value[Math.min(index, layers.value.length - 1)]?.id ?? null
  dirty.value = true
}
function removeSelected() { if (selectedId.value) removeLayer(selectedId.value) }

function copyLayer(cut = false) {
  if (!selected.value || busy.value) return
  endGesture()
  const snapshot = { ...selected.value }
  layerClipboard.value = { layer: snapshot, cut, pasteCount: 0 }
  if (cut) removeLayer(snapshot.id)
  notify(cut ? '图层已剪切，可粘贴到当前项目' : '图层已复制')
}

function pasteLayer() {
  if (!layerClipboard.value || !background.value || busy.value) return
  const clipboard = layerClipboard.value
  const offset = 20 * (clipboard.pasteCount + (clipboard.cut ? 0 : 1))
  const layer = pastedLayer(clipboard.layer, background.value, crypto.randomUUID(), offset)
  selectTool('select'); endLayerDrag()
  layers.value.push(layer)
  selectedId.value = layer.id
  clipboard.pasteCount++
  dirty.value = true
  notify('图层已粘贴')
}

function startLayerDrag(event: DragEvent, id: string) {
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
    layers.value = reorderLayers(layers.value, draggedLayerId.value, id, dropTarget.value.before)
    dirty.value = true
  }
  endLayerDrag()
}

function renameLayer(id: string, name: string) {
  const layer = layers.value.find(item => item.id === id)
  if (!layer || busy.value) return
  layer.name = name
  dirty.value = true
}
function setNameEditing(id: string, active: boolean) {
  if (active) editingLayerId.value = id
  else if (editingLayerId.value === id) editingLayerId.value = null
}

interface Gesture { id: string; pointerId: number; target: HTMLElement; start: Point; rect: Rect; corner?: Corner; scale: number; origin: Point }
let gesture: Gesture | null = null
function selectCanvasLayer(id: string) {
  selectedId.value = id
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
  guides.value = null
  guideMode.value = null
  event.preventDefault()
  selectCanvasLayer(layer.id)
  const target = event.currentTarget as HTMLElement
  const bounds = stage.value.getBoundingClientRect()
  const origin = { x: bounds.left, y: bounds.top }
  const point = screenToImage({ x: event.clientX, y: event.clientY }, origin, scale.value)
  const handleCorner = corner ? { x: corner.endsWith('e') ? layer.x + layer.width : layer.x, y: corner.startsWith('s') ? layer.y + layer.height : layer.y } : point
  // Account for clicking slightly off the exact corner, preventing a jump at drag start.
  gesture = { id: layer.id, pointerId: event.pointerId, target, start: { x: point.x - handleCorner.x, y: point.y - handleCorner.y }, rect: { x: layer.x, y: layer.y, width: layer.width, height: layer.height }, corner, scale: scale.value, origin }
  if (!corner) gesture.start = point
  target.setPointerCapture(event.pointerId)
}

function updateGesture(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId || !background.value) return
  const layer = layers.value.find(item => item.id === gesture!.id)
  if (!layer) return
  const point = screenToImage({ x: event.clientX, y: event.clientY }, gesture.origin, gesture.scale)
  const result = gesture.corner
    ? (!isImageLayer(layer) && event.ctrlKey ? resizeFreeRect : resizeRect)(gesture.rect, gesture.corner, { x: point.x - gesture.start.x, y: point.y - gesture.start.y }, background.value)
    : moveRect(gesture.rect, { x: point.x - gesture.start.x, y: point.y - gesture.start.y }, background.value)
  Object.assign(layer, result)
  guides.value = !gesture.corner ? proximityGuides(layer, layers.value, scale.value) : null
  guideMode.value = 'drag'
  dirty.value = true
}

function endGesture() {
  guides.value = null
  guideMode.value = null
  const current = gesture
  gesture = null
  if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
}

interface Drawing { pointerId: number; target: HTMLElement; start: Point; last: Point; scale: number; origin: Point }
let drawing: Drawing | null = null

function selectTool(value: typeof tool.value) {
  cancelDrawing(); endGesture()
  tool.value = value
  if (value !== 'select') selectedId.value = null
}

function beginDrawing(event: PointerEvent) {
  if (event.button !== 0) return
  if (tool.value === 'select') { selectedId.value = null; return }
  if (busy.value || event.button !== 0 || !stage.value || !background.value || drawing) return
  event.preventDefault()
  const box = stage.value.getBoundingClientRect()
  const origin = { x: box.left, y: box.top }
  const raw = screenToImage({ x: event.clientX, y: event.clientY }, origin, scale.value)
  const start = { x: clamp(raw.x, 0, background.value.width), y: clamp(raw.y, 0, background.value.height) }
  selectedId.value = null
  ctrlPressed.value = event.ctrlKey
  draft.value = { id: crypto.randomUUID(), kind: tool.value, color: defaultBorder.value, fillColor: defaultFill.value, name: '', ...drawRect(start, start, background.value, event.ctrlKey) }
  drawing = { pointerId: event.pointerId, target: stage.value, start, last: start, scale: scale.value, origin }
  stage.value.setPointerCapture(event.pointerId)
}

function refreshDrawing() {
  if (drawing && draft.value && background.value) Object.assign(draft.value, drawRect(drawing.start, drawing.last, background.value, ctrlPressed.value))
}

function updateDrawing(event: PointerEvent) {
  if (!drawing || drawing.pointerId !== event.pointerId) return
  drawing.last = screenToImage({ x: event.clientX, y: event.clientY }, drawing.origin, drawing.scale)
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
  const equal = Math.abs(shape.width - shape.height) < 1e-6
  const prefix = shape.kind === 'rectangle' ? (equal ? '正方形' : '矩形') : (equal ? '圆形' : '椭圆')
  shape.name = `${prefix} ${layers.value.filter(layer => layer.kind === shape.kind).length + 1}`
  layers.value.push(shape)
  selectedId.value = shape.id
  dirty.value = true
  tool.value = 'select'
}

function setShapeColor(property: 'color' | 'fillColor', value: string | null) {
  if (busy.value) return
  if (property === 'color' && value) defaultBorder.value = value
  if (property === 'fillColor') defaultFill.value = value
  if (selectedShape.value) {
    if (property === 'color' && value) selectedShape.value.color = value
    if (property === 'fillColor') selectedShape.value.fillColor = value
    dirty.value = true
  }
  if (draft.value) {
    if (property === 'color' && value) draft.value.color = value
    if (property === 'fillColor') draft.value.fillColor = value
  }
}

function chooseLayer(id: string) { selectTool('select'); selectedId.value = id }

const round = (value: number) => Math.round(value)
const formatPoint = (x: number, y: number) => `(${round(x)}, ${round(y)})`
const layerStyle = (layer: Layer, index: number) => ({ left: `${layer.x * scale.value}px`, top: `${layer.y * scale.value}px`, width: `${layer.width * scale.value}px`, height: `${layer.height * scale.value}px`, zIndex: index + 1 })
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'
const fileStem = () => (background.value?.name.replace(/\.[^.]+$/, '') || 'frame')

function exportCoordinates() {
  if (!background.value) return
  downloadJson(coordinateData(background.value, layers.value), `${fileStem()}-coordinates.json`)
  showExport.value = false
  notify('坐标 JSON 已导出')
}

async function copyCoordinates() {
  if (!background.value) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(coordinateData(background.value, layers.value), null, 2))
    notify('坐标 JSON 已复制')
  } catch { notify('复制失败，请使用“导出坐标 JSON”保存。', true) }
  showExport.value = false
}

function saveProject() {
  if (!background.value) return
  const project: Project = { version: 2, background: background.value, layers: layers.value }
  downloadJson(project, `${fileStem()}.frame.json`)
  dirty.value = false
  notify('项目已保存，包含所有图片和精确坐标')
}

async function openProject(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  try {
    const project = parseProject(await file.text())
    const images = await Promise.all([decodeImage(project.background.src), ...project.layers.map(layer => isImageLayer(layer) ? decodeImage(layer.src) : Promise.resolve(null))])
    const bg = images[0]!
    if (!bg || bg.naturalWidth !== project.background.width || bg.naturalHeight !== project.background.height) throw new Error('项目背景尺寸与图片不一致。')
    project.layers.forEach((layer, index) => {
      if (!isImageLayer(layer)) return
      const image = images[index + 1]!
      const ratio = image.naturalWidth / image.naturalHeight
      if (Math.abs(layer.width / layer.height - ratio) / ratio > 1e-6) throw new Error('项目中的图片宽高比例无效。')
    })
    if (dirty.value && background.value && !window.confirm('当前项目有未保存的更改。打开新项目会替换当前内容，是否继续？')) return
    cancelDrawing(); endGesture(); tool.value = 'select'
    background.value = project.background
    layers.value = project.layers
    addedImageCount = project.layers.filter(isImageLayer).length
    selectedId.value = project.layers.at(-1)?.id ?? null
    dirty.value = false
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
    download(blob, `${fileStem()}-composition.png`)
    notify('合成 PNG 已导出')
  } catch (error) { notify(errorText(error), true) }
  finally { busy.value = false }
}

function onKeydown(event: KeyboardEvent) {
  ctrlPressed.value = event.ctrlKey
  if (event.key === 'Control') refreshDrawing()
  if (confirmReplace.value) { if (event.key === 'Escape') cancelReplace(); return }
  if (event.key === 'Escape') { cancelDrawing(); endGesture(); endPan(); tool.value = 'select'; selectedId.value = null; showExport.value = false }
  const target = event.target as HTMLElement
  if (event.isComposing || target?.isContentEditable || target?.closest('input, textarea, select')) return
  const key = event.key.toLowerCase()
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selected.value && background.value && !busy.value && tool.value === 'select' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    endGesture()
    const step = event.shiftKey ? 10 : 1
    const rect = moveRect(selected.value, { x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0 }, background.value)
    if (rect.x !== selected.value.x || rect.y !== selected.value.y) { Object.assign(selected.value, rect); dirty.value = true }
    guides.value = proximityGuides(selected.value, layers.value, scale.value)
    guideMode.value = 'keyboard'
    return
  }
  if (key === 'a' && background.value && !busy.value && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    if (!event.repeat) layerInput.value?.click()
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && ['c', 'x', 'v'].includes(key)) {
    const available = key === 'v' ? background.value && layerClipboard.value : selected.value
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
  if ((event.key === 'Delete' || event.key === 'Backspace') && selected.value) { event.preventDefault(); removeSelected() }
}
function onKeyup(event: KeyboardEvent) { ctrlPressed.value = event.ctrlKey; if (event.key === 'Control') refreshDrawing() }
function onBlur() { ctrlPressed.value = false; cancelDrawing(); endGesture(); endPan() }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value && background.value) { event.preventDefault(); event.returnValue = '' } }
function closeExport(event: MouseEvent) { if (!(event.target as HTMLElement).closest('.export-wrap')) showExport.value = false }

onMounted(() => {
  observer = new ResizeObserver(() => { cancelDrawing(); endGesture(); endPan(); fitStage() })
  if (workspace.value) observer.observe(workspace.value)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('blur', onBlur)
  window.addEventListener('beforeunload', beforeUnload)
  document.addEventListener('click', closeExport)
})
onBeforeUnmount(() => {
  cancelDrawing(); endGesture(); endPan(); observer?.disconnect(); clearTimeout(toastTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('beforeunload', beforeUnload)
  document.removeEventListener('click', closeExport)
})
</script>

<template>
  <div class="app-shell" :aria-busy="busy">
    <header class="topbar">
      <div class="brand"><img class="brand-logo" :src="logoUrl" alt="瓦肯青少年编程 VULCODING" /></div>
      <div class="toolbar">
        <button class="button" :disabled="busy" @click="projectInput?.click()"><span class="button-icon">↗</span>打开项目</button>
        <span class="toolbar-divider"></span>
        <button class="button" :disabled="busy" @click="bgInput?.click()"><span class="button-icon">▧</span>{{ background ? '替换背景' : '加载背景' }}</button>
        <button class="button" aria-keyshortcuts="a" title="添加图片（A）" :disabled="!background || busy" @click="layerInput?.click()"><span class="button-icon">＋</span>添加图片 <kbd>A</kbd></button>
        <button class="button" :disabled="!background || busy" @click="saveProject"><span class="button-icon">▣</span>保存项目<span v-if="dirty && background" class="unsaved-dot" title="有未保存更改"></span></button>
        <div class="export-wrap">
          <button class="button primary" aria-label="导出" :disabled="!background || busy" :aria-expanded="showExport" @click="showExport = !showExport">导出<span class="chevron" aria-hidden="true">⌄</span></button>
          <div v-if="showExport" class="export-menu">
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

    <main class="main-layout">
      <section class="editor-panel" aria-label="图片编辑区">
        <div class="editor-heading"><div><span class="section-kicker">WORKSPACE</span><h1>{{ background ? background.name : '让每个位置，都有坐标。' }}</h1></div><span class="local-badge"><i></i>本地处理</span></div>
        <div ref="workspace" class="workspace" :class="{ 'has-background': background, drawing: tool !== 'select', panning }" @wheel="zoomMap" @contextmenu.prevent @pointerdown.capture="beginPan" @pointermove.capture="updatePan" @pointerup.capture="endPan" @pointercancel="endPan" @lostpointercapture="endPan" @pointerdown.self="selectedId = null">
          <div v-if="background" class="drawing-tools" aria-label="绘图工具"><button aria-label="选择工具" aria-keyshortcuts="1" :aria-pressed="tool === 'select'" :disabled="busy" @click="selectTool('select')">↖ 选择 <kbd>1</kbd></button><button aria-label="绘制正方形" aria-keyshortcuts="2" :aria-pressed="tool === 'rectangle'" :disabled="busy" @click="selectTool('rectangle')">□ 正方形 <kbd>2</kbd></button><button aria-label="绘制圆形" aria-keyshortcuts="3" :aria-pressed="tool === 'ellipse'" :disabled="busy" @click="selectTool('ellipse')">○ 圆形 <kbd>3</kbd></button><span>{{ tool === 'select' ? '选择图形后按 Ctrl 自由缩放' : ctrlPressed ? 'Ctrl：自由宽高' : '按住 Ctrl 绘制矩形 / 椭圆' }}</span></div>
          <div v-if="!background" class="empty-workspace">
            <div class="empty-art" aria-hidden="true"><div class="art-back"></div><div class="art-front"><svg viewBox="0 0 80 60" fill="none"><circle cx="57" cy="17" r="6" fill="currentColor"/><path d="M10 48 29 26l15 17 10-11 17 16H10Z" fill="currentColor"/></svg></div><span class="art-cross">＋</span><span class="art-corner"></span></div>
            <span class="empty-kicker">YOUR CANVAS STARTS HERE</span>
            <h2>先放一张背景图片</h2>
            <p>添加角色与物品，自由摆放、等比例缩放。<br />每一处位置，都能实时读取原图坐标。</p>
            <button class="button primary load-button" :disabled="busy" @click="bgInput?.click()"><span>＋</span>加载背景图片</button>
            <span class="file-note">PNG / JPEG / WebP · 图片仅在本机处理</span>
            <div class="workflow"><span><b>01</b>加载背景</span><i>→</i><span><b>02</b>摆放图片</span><i>→</i><span><b>03</b>导出成果</span></div>
          </div>
          <div v-else ref="stage" class="stage" :style="stageStyle" data-testid="stage" @pointerdown="beginDrawing" @pointermove="updateDrawing" @pointerup="finishDrawing" @pointercancel="cancelDrawing" @lostpointercapture="cancelDrawing">
            <img class="background-image" :src="background.src" :alt="background.name" draggable="false" />
            <span class="origin-label">0, 0</span>
            <div v-for="(layer, index) in layers" :key="layer.id" class="image-layer" :class="{ selected: layer.id === selectedId }" :style="layerStyle(layer, index)" :data-layer-id="layer.id" data-testid="image-layer" role="button" tabindex="0" :aria-label="`选择 ${layer.name}`" :aria-pressed="layer.id === selectedId" @keydown.enter="selectCanvasLayer(layer.id)" @keydown.space.prevent="selectCanvasLayer(layer.id)" @pointerdown.stop="beginGesture($event, layer)" @pointermove="updateGesture" @pointerup="endGesture" @pointercancel="endGesture" @lostpointercapture="endGesture">
              <img v-if="isImageLayer(layer)" :src="layer.src" :alt="layer.name" draggable="false" />
              <ShapeView v-else :shape="layer" />
              <template v-if="layer.id === selectedId">
                <button v-for="corner in corners" :key="corner" class="resize-handle" :class="corner" :data-testid="`resize-${corner}`" :aria-label="`从${cornerLabels[corner]}等比例缩放`" @pointerdown.stop="beginGesture($event, layer, corner)"></button>
              </template>
            </div>
            <div v-if="draft" class="shape-preview" :style="layerStyle(draft, layers.length)"><ShapeView :shape="draft" /></div>
            <DistanceGuides v-if="hasGuides && guides" :guides="guides" :scale="scale" :style="{ zIndex: layers.length + 4 }" />
            <div class="annotation-overlay name-overlay" :style="{ zIndex: 0 }"><div v-for="(layer, index) in layers" :key="layer.id" class="annotation-box" :style="layerStyle(layer, index)"><span v-if="layer.name && layer.id === selectedId && !hasGuides" class="object-name" data-testid="object-name">{{ layer.name }}</span></div></div>
            <div v-if="selected && (!hasGuides || guideMode === 'keyboard')" class="annotation-overlay coordinate-overlay" :style="{ zIndex: layers.length + 3 }"><div class="annotation-box" :style="layerStyle(selected, 0)"><template v-if="isImageLayer(selected)"><i class="center-marker"></i><span class="selection-tag center-tag" data-testid="center-label">{{ formatPoint(selected.x + selected.width / 2, selected.y + selected.height / 2) }}</span></template><template v-else><span class="selection-tag" data-testid="top-left-label">{{ formatPoint(selected.x, selected.y) }}</span><span class="selection-tag bottom-tag" data-testid="bottom-right-label">{{ formatPoint(selected.x + selected.width, selected.y + selected.height) }}</span></template></div></div>
          </div>
        </div>
        <div class="editor-footer"><span><span class="hint-icon">⌖</span>{{ background ? '拖动对象 · 四角缩放 · 滚轮缩放地图 · 右键拖动地图' : '原点位于背景左上角，横轴向右，纵轴向下' }}</span><span class="zoom-readout">{{ background ? `${round(background.width)} × ${round(background.height)} px · ${Math.round(scale * 100)}%` : '坐标单位：原图像素' }} <button v-if="background" class="fit-map" :disabled="busy" @click="cancelDrawing(); endGesture(); fitStage(true)">适应窗口</button></span></div>
      </section>

      <aside class="sidebar">
        <div class="sidebar-title"><h2>对象图层</h2></div>
        <p class="sidebar-description">拖曳卡片调整顺序，越靠上显示在越上层。</p>
        <div ref="layerList" class="layer-list" @dragend="endLayerDrag" @dragleave.self="dropTarget = null">
          <div v-if="!layers.length" class="empty-layers"><span class="stack-icon">▱<br />▱</span><strong>还没有添加图片</strong><p>{{ background ? '添加角色或物品，开始摆放。' : '加载背景后，在这里管理图片。' }}</p><button v-if="background" class="text-button" :disabled="busy" @click="layerInput?.click()">＋ 添加第一张图片</button></div>
          <div v-for="(layer, index) in [...layers].reverse()" :key="layer.id" class="layer-card" :class="{ active: layer.id === selectedId, dragging: draggedLayerId === layer.id, 'drop-before': dropTarget?.id === layer.id && dropTarget.before, 'drop-after': dropTarget?.id === layer.id && !dropTarget.before }" role="button" tabindex="0" :aria-label="`选择图层 ${layer.name || '未命名对象'}`" :aria-pressed="layer.id === selectedId" :draggable="!busy && editingLayerId !== layer.id" :data-card-id="layer.id" data-testid="layer-card" @click="chooseLayer(layer.id)" @keydown.enter.self="chooseLayer(layer.id)" @keydown.space.self.prevent="chooseLayer(layer.id)" @dragstart="startLayerDrag($event, layer.id)" @dragover.prevent="previewLayerDrop($event, layer.id)" @drop.stop.prevent="dropLayer($event, layer.id)">
            <button class="layer-delete" :aria-label="`删除${isImageLayer(layer) ? '图片' : '图形'}`" :title="`删除 ${layer.name || '未命名对象'}`" :disabled="busy" draggable="false" @click.stop="removeLayer(layer.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" /></svg></button>
            <div class="layer-card-header"><span class="layer-number" data-testid="layer-number" :title="`图层顺序 ${index + 1}`">{{ index + 1 }}</span><div class="thumbnail"><img v-if="isImageLayer(layer)" :src="layer.src" alt="" draggable="false" /><span v-else class="shape-thumbnail" :class="layer.kind" :style="{ borderColor: layer.color, backgroundColor: layer.fillColor ? `${layer.fillColor}40` : 'transparent' }"></span></div><div class="layer-name"><EditableName :name="layer.name" :disabled="busy" @select="chooseLayer(layer.id)" @rename="renameLayer(layer.id, $event)" @editing="setNameEditing(layer.id, $event)" /><small>{{ round(layer.width) }} × {{ round(layer.height) }} px</small></div></div>
            <div v-if="isImageLayer(layer) && layer.id === selectedId" class="anchor-grid" data-testid="anchor-grid"><span v-for="(point, key) in anchorPoints(layer)" :key="key"><small>{{ key }}</small><b>{{ formatPoint(point.x, point.y) }}</b></span></div>
            <div v-else class="layer-coordinates"><span>左上角 <b>{{ formatPoint(layer.x, layer.y) }}</b></span><span>中心点 <b>{{ formatPoint(layer.x + layer.width / 2, layer.y + layer.height / 2) }}</b></span><span>右下角 <b>{{ formatPoint(layer.x + layer.width, layer.y + layer.height) }}</b></span></div>
          </div>
        </div>
        <section v-if="selectedShape || tool !== 'select'" class="shape-colors" aria-label="图形颜色"><div><strong>边框颜色</strong><div class="color-swatches"><button v-for="color in palette" :key="color.value" :aria-label="`边框${color.name}`" :aria-pressed="borderColor === color.value" :disabled="busy" :style="{ background: color.value }" @click="setShapeColor('color', color.value)"></button></div></div><div><strong>填充颜色 <small>25% 不透明度</small></strong><div class="color-swatches"><button class="no-fill" aria-label="无填充" :aria-pressed="!fillColor" :disabled="busy" @click="setShapeColor('fillColor', null)">∅</button><button v-for="color in palette" :key="color.value" :aria-label="`填充${color.name}`" :aria-pressed="fillColor === color.value" :disabled="busy" :style="{ background: color.value }" @click="setShapeColor('fillColor', color.value)"></button></div></div></section>
        <div v-if="background" class="background-info"><span>背景图片</span><strong :title="background.name">{{ background.name }}</strong><small>{{ background.width }} × {{ background.height }} px</small></div>
      </aside>
    </main>
    <footer class="app-footer"><span>VULCODING / IMAGE COORDINATE STUDIO</span><span>本机编辑，精确定位。<i></i>无需上传</span></footer>
    <div v-if="busy" class="busy-indicator" role="status">正在处理图片…</div>
    <div v-if="message" class="toast" :class="{ error: isError }" role="status"><span>{{ isError ? '!' : '✓' }}</span>{{ message }}<button aria-label="关闭提示" @click="message = ''">×</button></div>
    <div v-if="confirmReplace" class="modal-backdrop" @click.self="cancelReplace">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="replace-title"><span class="section-kicker">REPLACE BACKGROUND</span><h2 id="replace-title">替换背景图片？</h2><p>替换后将清空当前 {{ layers.length }} 张叠加图片。需要保留时，请先取消并保存项目。</p><div class="modal-actions"><button class="button" autofocus @click="cancelReplace">取消</button><button class="button primary" @click="replaceBackground">替换并清空</button></div></section>
    </div>
  </div>
</template>
