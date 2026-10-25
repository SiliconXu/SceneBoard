<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AnimationGroup, Layer } from './project'
import { analyzeResources, animationFrameName, animationSize, buildAnimationFiles } from './animation'
import { assertCanvasSize } from './background'
import { download, readImage } from './files'
import { packPygameZip } from './pygame-export'
import AnimationPreview from './AnimationPreview.vue'
import { useDialog } from './use-dialog'

const props = defineProps<{ groups: AnimationGroup[]; layers: Layer[]; initialId?: string }>()
const emit = defineEmits<{ close: []; apply: [groups: AnimationGroup[]] }>()
const groups = ref<AnimationGroup[]>(JSON.parse(JSON.stringify(props.groups)))
const activeId = ref(props.initialId ?? groups.value[0]?.id ?? '')
const active = computed(() => groups.value.find(group => group.id === activeId.value))
const index = ref(0)
const playing = ref(false)
const busy = ref(false)
const error = ref('')
const dialog = ref<HTMLElement>()
const nameInput = ref<HTMLInputElement>()
const filesInput = ref<HTMLInputElement>()
const dragged = ref<string | null>(null)
const dropTarget = ref<{ id: string; before: boolean } | null>(null)
let timer: ReturnType<typeof setInterval> | undefined
let alive = true
function close() { if (!busy.value) emit('close') }
useDialog(dialog, close)
onMounted(() => { if (props.initialId) { nameInput.value?.focus(); nameInput.value?.select() } })
watch(activeId, () => { playing.value = false; index.value = 0; error.value = ''; dragged.value = null; dropTarget.value = null })
watch(() => [playing.value, active.value?.fps, active.value?.frames.length, activeId.value], () => {
  clearInterval(timer)
  const group = active.value
  if (playing.value && group && Number.isInteger(group.fps) && group.fps >= 1 && group.fps <= 60 && group.frames.length) timer = setInterval(() => { index.value = (index.value + 1) % group.frames.length }, 1000 / group.fps)
  else playing.value = false
})
onBeforeUnmount(() => { alive = false; clearInterval(timer) })
const size = computed(() => active.value ? animationSize(active.value) : null)
const issues = computed(() => analyzeResources(props.layers, groups.value))
const activeIssue = computed(() => issues.value.find(issue => issue.target === 'animation' && issue.id === activeId.value))
const structuralError = computed(() => {
  for (const group of groups.value) {
    if (!group.frames.length) return `${group.name || '未命名组'}：至少导入一帧，或删除空组。`
    if (!Number.isInteger(group.fps) || group.fps < 1 || group.fps > 60) return `${group.name || '未命名组'}：FPS 须为 1–60 的整数。`
    try { assertCanvasSize(animationSize(group)) } catch (cause) { return `${group.name}：${(cause as Error).message}` }
  }
  return ''
})
// Single-group export checks every resource name, including other groups and scene images.
const canExport = computed(() => !!active.value?.frames.length && !structuralError.value && !activeIssue.value)
function addGroup() {
  let suffix = 1
  while (groups.value.some(group => group.name === `animation_${suffix}`)) suffix++
  const group: AnimationGroup = { id: crypto.randomUUID(), name: `animation_${suffix}`, fps: 10, frames: [] }
  groups.value.push(group); activeId.value = group.id
  void nextTick(() => { nameInput.value?.focus(); nameInput.value?.select() })
}
function removeGroup() {
  if (!active.value || !window.confirm(`删除动画组“${active.value.name || '未命名组'}”及全部帧？应用后生效。`)) return
  const at = groups.value.findIndex(group => group.id === activeId.value)
  groups.value.splice(at, 1); activeId.value = groups.value[Math.min(at, groups.value.length - 1)]?.id ?? ''
}
async function importFrames(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? [])
  input.value = ''
  const group = active.value
  if (!group || !files.length || busy.value) return
  busy.value = true; playing.value = false; error.value = ''
  try {
    const images = await Promise.all(files.map(readImage))
    if (!alive) return
    const frames = images.map(image => ({ ...image, id: crypto.randomUUID() }))
    for (const frame of frames) assertCanvasSize(frame)
    assertCanvasSize(animationSize({ ...group, frames: [...group.frames, ...frames] }))
    group.frames.push(...frames)
  } catch (cause) { if (alive) error.value = `导入失败：${(cause as Error).message}` }
  finally { if (alive) busy.value = false }
}
function selectFrame(at: number) { playing.value = false; index.value = at }
function moveFrame(from: number, to: number) {
  const group = active.value
  if (!group || to < 0 || to >= group.frames.length || from === to) return
  const currentId = group.frames[index.value]?.id
  const [frame] = group.frames.splice(from, 1); group.frames.splice(to, 0, frame!)
  index.value = group.frames.findIndex(frame => frame.id === currentId); playing.value = false
}
function removeFrame(at: number) {
  active.value?.frames.splice(at, 1)
  index.value = Math.max(0, Math.min(index.value, (active.value?.frames.length ?? 0) - 1)); playing.value = false
}
function previewDrop(event: DragEvent, id: string) {
  if (!dragged.value || dragged.value === id) { dropTarget.value = null; return }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { id, before: event.clientY < rect.top + rect.height / 2 }
}
function dropFrame(event: DragEvent, id: string) {
  previewDrop(event, id)
  const group = active.value
  if (group && dragged.value && dropTarget.value) {
    const from = group.frames.findIndex(frame => frame.id === dragged.value)
    const target = group.frames.findIndex(frame => frame.id === id)
    const to = target + (dropTarget.value.before ? 0 : 1) - (from < target ? 1 : 0)
    if (from >= 0 && target >= 0) moveFrame(from, to)
  }
  dragged.value = null; dropTarget.value = null
}
async function exportFrames() {
  if (!active.value || !canExport.value || busy.value) return
  busy.value = true; playing.value = false; error.value = ''
  try {
    const group = JSON.parse(JSON.stringify(active.value)) as AnimationGroup
    const files = await buildAnimationFiles(group)
    const zip = packPygameZip(group.name, files)
    await download(new Blob([zip], { type: 'application/zip' }), `${group.name}-frames.zip`)
  } catch (cause) { if (alive) error.value = (cause as Error).message }
  finally { if (alive) busy.value = false }
}
function apply() { if (!busy.value && !structuralError.value) emit('apply', JSON.parse(JSON.stringify(groups.value))) }
</script>

<template>
  <div class="modal-backdrop" @click.self="close">
    <section ref="dialog" class="modal animation-dialog" role="dialog" aria-modal="true" aria-labelledby="animation-title" :aria-busy="busy" tabindex="-1">
      <h2 id="animation-title">动画素材</h2>
      <p>独立整理帧图片，不加入场景。不同尺寸居中补透明画布；项目导出附带播放示例，在 Python 中指定角色后启用。</p>
      <div class="animation-layout">
        <nav class="animation-groups" aria-label="动画组"><button v-for="group in groups" :key="group.id" :aria-pressed="activeId === group.id" :disabled="busy" @click="activeId = group.id">{{ group.name || '未命名组' }}<small>{{ group.frames.length }} 帧</small></button><button class="button" :disabled="busy" @click="addGroup">＋ 新增组</button></nav>
        <div v-if="active" class="animation-editor">
          <div class="animation-settings"><label>名称前缀<input ref="nameInput" v-model="active.name" aria-label="动画名称前缀" :disabled="busy" maxlength="100" :spellcheck="false" /></label><label>FPS<input :value="active.fps" type="number" min="1" max="60" step="1" aria-label="动画 FPS" :disabled="busy" @input="active.fps = Number(($event.target as HTMLInputElement).value)" /></label><button class="delete-button" :disabled="busy" @click="removeGroup">删除组</button></div>
          <template v-if="active.frames.length">
            <AnimationPreview :key="active.id" :group="active" :index="index" />
            <div class="animation-playback"><button class="button" :disabled="busy || !!structuralError" @click="playing = !playing">{{ playing ? '暂停' : '播放' }}</button><button class="button" aria-label="上一帧" :disabled="busy" @click="selectFrame((index + active.frames.length - 1) % active.frames.length)">‹</button><span aria-live="off" data-testid="frame-counter">{{ index + 1 }} / {{ active.frames.length }}</span><button class="button" aria-label="下一帧" :disabled="busy" @click="selectFrame((index + 1) % active.frames.length)">›</button><small>循环 · {{ size?.width }} × {{ size?.height }} px</small></div>
          </template>
          <p v-else class="animation-empty">导入 PNG、JPEG 或 WebP 图片作为帧。</p>
          <div class="animation-frame-actions"><button class="button" :disabled="busy" @click="filesInput?.click()">{{ active.frames.length ? '追加帧…' : '导入帧…' }}</button><button class="button" :disabled="busy || !canExport" @click="exportFrames">导出本组帧 ZIP</button></div>
          <p v-if="active.frames.some(frame => frame.width !== size?.width || frame.height !== size?.height)" class="frame-size-hint">原尺寸不同：统一为 {{ size?.width }} × {{ size?.height }} px，居中补透明画布，不拉伸；多出的像素放在右侧／下侧。</p>
          <ol class="animation-frames" aria-label="动画帧顺序" @dragend="dragged = null; dropTarget = null">
            <li v-for="(frame, at) in active.frames" :key="frame.id" :class="{ 'current-frame': index === at, 'drop-before': dropTarget?.id === frame.id && dropTarget.before, 'drop-after': dropTarget?.id === frame.id && !dropTarget.before }" :draggable="!busy" :data-frame-id="frame.id" @dragstart="dragged = frame.id; playing = false; $event.dataTransfer?.setData('text/plain', frame.id)" @dragover.prevent="previewDrop($event, frame.id)" @drop.prevent="dropFrame($event, frame.id)">
              <button class="frame-select" :aria-label="`查看第 ${at + 1} 帧`" :aria-pressed="index === at" :disabled="busy" @click="selectFrame(at)"><img :src="frame.src" alt="" draggable="false" /><span><strong>{{ animationFrameName(active, at) }}.png</strong><small>{{ frame.name }} · {{ frame.width }} × {{ frame.height }}</small></span></button>
              <button class="frame-order" :aria-label="`上移第 ${at + 1} 帧`" :disabled="busy || at === 0" @click="moveFrame(at, at - 1)">↑</button><button class="frame-order" :aria-label="`下移第 ${at + 1} 帧`" :disabled="busy || at === active.frames.length - 1" @click="moveFrame(at, at + 1)">↓</button><button class="frame-order delete-button" :aria-label="`删除第 ${at + 1} 帧`" :disabled="busy" @click="removeFrame(at)">×</button>
            </li>
          </ol>
          <p v-if="activeIssue" class="form-error" role="alert">{{ activeIssue.reason }}</p>
          <p v-if="!activeIssue && issues.length" class="form-error" role="alert">其他图层或动画组名称存在问题，导出整个项目前请修正。<button v-for="issue in issues.filter(issue => issue.target === 'animation')" :key="issue.id" class="text-button" @click="activeId = issue.id">{{ issue.name || '未命名组' }} · 定位修改</button></p>
        </div>
        <p v-else class="animation-empty">点击「新增组」，开始整理动画帧。</p>
      </div>
      <input ref="filesInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden data-testid="animation-input" @change="importFrames" />
      <p v-if="structuralError" class="form-error" role="alert">{{ structuralError }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="modal-actions"><button class="button" :disabled="busy" @click="close">取消</button><button class="button primary" :disabled="busy || !!structuralError" @click="apply">应用到项目</button></div>
    </section>
  </div>
</template>
