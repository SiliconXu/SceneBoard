<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { type Rect } from './geometry'
import { isImageLayer, type Layer } from './project'
import { distributeSelection, positionAt, selectionBounds, type Alignment, type Axis, type PositionAnchor, type RectField } from './transforms'

const props = defineProps<{ layers: Layer[]; disabled: boolean }>()
const emit = defineEmits<{
  edit: [field: RectField, value: number, anchor: PositionAnchor, proportional: boolean]
  align: [alignment: Alignment]
  distribute: [axis: Axis]
  flip: [axis: 'flipX' | 'flipY']
  crop: []
}>()
const anchor = ref<PositionAnchor>('center')
const lockRatio = ref(true)
const error = ref('')
const modified = ref(new Set<RectField>())
const drafts = ref<Record<RectField, string>>({ x: '', y: '', width: '', height: '' })
const box = computed(() => selectionBounds(props.layers)!)
const single = computed(() => props.layers.length === 1 ? props.layers[0]! : null)
const image = computed(() => !!single.value && isImageLayer(single.value))
function flipState(axis: 'flipX' | 'flipY') {
  const images = props.layers.filter(isImageLayer)
  return images.every(layer => !!layer[axis]) ? true : images.every(layer => !layer[axis]) ? false : 'mixed'
}
const fields: { key: RectField; label: string }[] = [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }, { key: 'width', label: '宽' }, { key: 'height', label: '高' }]
const visibleFields = computed(() => single.value ? fields : fields.slice(0, 2))
const alignments: { key: Alignment; label: string; path: string }[] = [
  { key: 'left', label: '左对齐', path: 'M4 3v18M8 6h12v4H8zM8 14h8v4H8z' },
  { key: 'centerX', label: '水平居中对齐', path: 'M12 3v18M5 6h14v4H5zM8 14h8v4H8z' },
  { key: 'right', label: '右对齐', path: 'M20 3v18M4 6h12v4H4zM8 14h8v4H8z' },
  { key: 'top', label: '顶部对齐', path: 'M3 4h18M6 8h4v12H6zM14 8h4v8h-4z' },
  { key: 'centerY', label: '垂直居中对齐', path: 'M3 12h18M6 5h4v14H6zM14 8h4v8h-4z' },
  { key: 'bottom', label: '底部对齐', path: 'M3 20h18M6 4h4v12H6zM14 8h4v8h-4z' },
]
const distributions: { axis: Axis; label: string; path: string }[] = [
  { axis: 'x', label: '水平等间距', path: 'M3 4v16M21 4v16M10 6h4v12h-4zM5 12h3M16 12h3' },
  { axis: 'y', label: '垂直等间距', path: 'M4 3h16M4 21h16M6 10h12v4H6zM12 5v3M12 16v3' },
]
const flips = [
  { axis: 'flipX' as const, label: '水平翻转', path: 'M12 3v3m0 3v3m0 3v3m0 3v0M8 6 3 18h5zM16 6l5 12h-5z' },
  { axis: 'flipY' as const, label: '垂直翻转', path: 'M3 12h3m3 0h3m3 0h3m3 0h0M6 8l12-5v5zM6 16l12 5v-5z' },
]
const dimension = (value: number) => String(Math.round(value))
function values(): Rect { return { ...box.value, ...positionAt(box.value, anchor.value) } }
function reset() {
  const current = values()
  drafts.value = Object.fromEntries(fields.map(({ key }) => [key, String(Math.round(current[key]))])) as Record<RectField, string>
  modified.value.clear()
}
watch(() => [props.layers.map(layer => [layer.id, layer.x, layer.y, layer.width, layer.height]), anchor.value], () => { error.value = ''; reset() }, { immediate: true, deep: true })
watch(() => props.layers.map(layer => layer.id).join(','), () => { lockRatio.value = true })
function commit(field: RectField) {
  // Rounded readouts must not write back to the precise project on focus/blur.
  if (!modified.value.has(field)) return
  const text = drafts.value[field].trim()
  const number = text === '' ? NaN : Number(text)
  if (!Number.isFinite(number) || ((field === 'width' || field === 'height') && number <= 0)) {
    error.value = '请输入有效数字，宽高必须大于 0。'
    reset(); return
  }
  error.value = ''
  emit('edit', field, number, anchor.value, image.value || lockRatio.value)
  reset()
}
function cancel() { error.value = ''; reset() }
function distributionHint(axis: Axis) {
  return props.layers.length < 3 ? '至少选择 3 个对象' : distributeSelection(props.layers, axis) ? '固定首尾，均分对象边缘间距' : '空间不足，无法形成非负间距'
}
</script>

<template>
  <section class="selection-properties" aria-label="选择属性" @pointerdown.stop @keydown.esc.stop.prevent="cancel">
    <div class="properties-row">
      <strong class="properties-heading">{{ single ? '位置与尺寸' : `已选择 ${layers.length} 个对象` }}</strong>
      <label class="anchor-choice">定位<select v-model="anchor" aria-label="定位点" :disabled="disabled"><option value="center">中心</option><option value="topleft">左上角</option></select></label>
      <div class="property-fields">
        <label v-for="field in visibleFields" :key="field.key">{{ field.label }}<input v-model="drafts[field.key]" type="text" inputmode="decimal" :aria-label="`${field.label}（原图像素）`" :disabled="disabled" :spellcheck="false" @input="modified.add(field.key)" @blur="commit(field.key)" @keydown.enter.stop.prevent="commit(field.key)" @keydown.esc.stop.prevent="cancel" /></label>
      </div>
      <span v-if="!single" class="selection-dimensions" aria-label="选区尺寸（只读）" :title="`选区整体外框：宽 ${box.width}，高 ${box.height} 像素，仅供查看`">尺寸 {{ dimension(box.width) }} × {{ dimension(box.height) }} px</span>
      <span v-else class="property-unit" aria-hidden="true">px</span>
    </div>
    <div class="selection-tools">
      <div v-if="!single" class="arrangement-controls" aria-label="排列对象">
        <div class="alignment-buttons" role="group" aria-label="对齐"><span class="action-label">对齐</span><button v-for="item in alignments" :key="item.key" :aria-label="item.label" :title="item.label" :disabled="disabled" @click="emit('align', item.key)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.path" /></svg></button></div>
        <div class="distribution-buttons" role="group" aria-label="分布"><span class="action-label">分布</span><span v-for="item in distributions" :key="item.axis" :title="distributionHint(item.axis)"><button :aria-label="item.label" :title="item.label" :disabled="disabled || !distributeSelection(layers, item.axis)" :aria-description="distributionHint(item.axis)" @click="emit('distribute', item.axis)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.path" /></svg></button></span></div>
      </div>
      <div v-if="layers.some(isImageLayer)" class="image-actions" role="group" aria-label="图片编辑"><span class="action-label">翻转</span><button v-for="item in flips" :key="item.axis" :disabled="disabled" :aria-label="item.label" :title="item.label" :aria-pressed="flipState(item.axis)" @click="emit('flip', item.axis)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.path" /></svg></button><button v-if="image" class="crop-action" :disabled="disabled" @click="emit('crop')">裁剪透明留白…</button></div>
      <label v-if="single && !image" class="ratio-choice"><input v-model="lockRatio" type="checkbox" :disabled="disabled" />数值输入保持比例</label>
    </div>
    <p v-if="error" class="property-error" role="alert">{{ error }}</p>
  </section>
</template>
