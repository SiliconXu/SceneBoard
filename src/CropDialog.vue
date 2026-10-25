<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { ImageLayer } from './project'
import { decodeImage } from './files'
import { trimBoundsByAlpha, croppedLayer, imageCanvas, sourceRect } from './image-processing'
import { anchorPoints, type Rect } from './geometry'
import ImageContent from './ImageContent.vue'
import { useDialog } from './use-dialog'

const props = defineProps<{ layer: ImageLayer }>()
const emit = defineEmits<{ close: []; apply: [layer: ImageLayer] }>()
const dialog = ref<HTMLElement>()
const loading = ref(true)
const error = ref('')
const tolerance = ref(3)
const alphaCutoff = computed(() => Math.round(tolerance.value / 100 * 255))
const originalArea = shallowRef<Rect | null>(null)
const boundsByAlpha = shallowRef<(Rect | null)[] | null>(null)
const bounds = computed(() => boundsByAlpha.value?.[alphaCutoff.value] ?? null)
const tooHigh = computed(() => !!boundsByAlpha.value?.[0] && !bounds.value)
const unchanged = computed(() => !!bounds.value && !!originalArea.value && bounds.value.x === 0 && bounds.value.y === 0 && bounds.value.width === originalArea.value.width && bounds.value.height === originalArea.value.height)
const message = computed(() => {
  if (error.value) return error.value
  if (loading.value) return ''
  if (tooHigh.value) return '当前容差过高，找不到可见主体，请调低透明噪点容差。'
  if (!bounds.value) return '图片完全透明，无法裁剪。'
  return unchanged.value ? '没有可裁剪的透明留白。' : ''
})
const result = computed(() => {
  const old = originalArea.value, box = bounds.value
  return old && box && !unchanged.value ? croppedLayer(props.layer, old, { ...box, x: old.x + box.x, y: old.y + box.y }) : null
})
let alive = true
onBeforeUnmount(() => { alive = false })
useDialog(dialog, () => emit('close'))
onMounted(async () => {
  try {
    const image = await decodeImage(props.layer.src)
    if (!alive) return
    const old = sourceRect({ width: image.naturalWidth, height: image.naturalHeight }, props.layer)
    const { canvas, context } = imageCanvas(old.width, old.height)
    context.drawImage(image, old.x, old.y, old.width, old.height, 0, 0, old.width, old.height)
    originalArea.value = old
    boundsByAlpha.value = trimBoundsByAlpha(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
    canvas.width = 0; canvas.height = 0
  } catch (cause) { error.value = (cause as Error).message }
  finally { if (alive) loading.value = false }
})
const previewScale = computed(() => Math.min(4, 340 / props.layer.width, 200 / props.layer.height))
const areaStyle = computed(() => ({ width: `${props.layer.width * previewScale.value}px`, height: `${props.layer.height * previewScale.value}px` }))
const croppedAreaStyle = computed(() => result.value ? ({ width: `${result.value.width * previewScale.value}px`, height: `${result.value.height * previewScale.value}px` }) : {})
const oldAnchors = computed(() => anchorPoints(props.layer))
const newAnchors = computed(() => result.value ? anchorPoints(result.value) : oldAnchors.value)
const point = (value: { x: number; y: number }) => `(${Math.round(value.x)}, ${Math.round(value.y)})`
const dimension = (value: number) => String(Math.round(value * 1000) / 1000)
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section ref="dialog" class="modal crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title" :aria-busy="loading" tabindex="-1">
      <h2 id="crop-title">裁剪透明留白</h2>
      <div class="crop-content">
      <p>四边分别裁到可见内容边缘，不保持原图长宽比。容差只用于确定外框，框内透明渐变保留，画布内的可见内容保持原位。</p>
      <div class="trim-tolerance">
        <label for="trim-tolerance">透明噪点容差 <strong>{{ tolerance }}%</strong></label>
        <input id="trim-tolerance" v-model.number="tolerance" type="range" min="0" max="15" step="1" :disabled="loading || !!error" :aria-valuetext="`${tolerance}% 不透明度及以下视为透明`" aria-describedby="trim-tolerance-hint" />
        <p id="trim-tolerance-hint">忽略不透明度 ≤ {{ tolerance }}% 的像素。0% 严格保留半透明边缘；调高可去除更强残影。</p>
      </div>
      <p v-if="loading" role="status">正在分析透明像素…</p>
      <p v-if="message" :role="tooHigh || error ? 'alert' : 'status'">{{ message }}</p>
      <template v-if="result">
        <div class="crop-comparison">
          <figure><figcaption>裁剪前</figcaption><div class="crop-preview-area" :style="areaStyle"><ImageContent :layer="layer" /></div></figure>
          <figure><figcaption>裁剪后 · 新外框</figcaption><div class="crop-preview-area is-cropped" :style="croppedAreaStyle"><ImageContent :layer="result" /></div></figure>
        </div>
        <table class="crop-values"><thead><tr><th>属性</th><th>裁剪前</th><th>裁剪后</th></tr></thead><tbody><tr><th>左上角</th><td>{{ point(layer) }}</td><td>{{ point(result) }}</td></tr><tr><th>尺寸（px）</th><td>{{ dimension(layer.width) }} × {{ dimension(layer.height) }}</td><td>{{ dimension(result.width) }} × {{ dimension(result.height) }}</td></tr><tr><th>中心</th><td>{{ point(oldAnchors.center) }}</td><td>{{ point(newAnchors.center) }}</td></tr></tbody></table>
        <details class="crop-anchors"><summary>九点锚点变化</summary><table class="crop-values"><tbody><tr v-for="(value, key) in oldAnchors" :key="key"><th>{{ key }}</th><td>{{ point(value) }}</td><td>{{ point(newAnchors[key]) }}</td></tr></tbody></table></details>
      </template>
      </div>
      <div class="modal-actions"><button class="button" @click="emit('close')">取消</button><button class="button primary" :disabled="loading || !result" @click="result && emit('apply', result)">确认裁剪</button></div>
    </section>
  </div>
</template>
