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
}>()
const anchor = ref<PositionAnchor>('center')
const lockRatio = ref(true)
const error = ref('')
const modified = ref(new Set<RectField>())
const drafts = ref<Record<RectField, string>>({ x: '', y: '', width: '', height: '' })
const box = computed(() => selectionBounds(props.layers)!)
const single = computed(() => props.layers.length === 1 ? props.layers[0]! : null)
const image = computed(() => !!single.value && isImageLayer(single.value))
const fields: { key: RectField; label: string }[] = [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }, { key: 'width', label: '宽' }, { key: 'height', label: '高' }]
const alignments: { key: Alignment; label: string; icon: string }[] = [
  { key: 'left', label: '左对齐', icon: '▏←' }, { key: 'centerX', label: '水平居中对齐', icon: '→│←' }, { key: 'right', label: '右对齐', icon: '→▕' },
  { key: 'top', label: '顶部对齐', icon: '↑▔' }, { key: 'centerY', label: '垂直居中对齐', icon: '↕─' }, { key: 'bottom', label: '底部对齐', icon: '↓▁' },
]
const distributions: { axis: Axis; label: string }[] = [{ axis: 'x', label: '水平等间距' }, { axis: 'y', label: '垂直等间距' }]
function values(): Rect { return { ...box.value, ...positionAt(box.value, anchor.value) } }
function reset() {
  const current = values()
  drafts.value = Object.fromEntries(fields.map(({ key }) => [key, String(key === 'x' || key === 'y' ? Math.round(current[key]) : current[key])])) as Record<RectField, string>
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
    <div class="properties-heading"><strong>{{ single ? '位置与尺寸' : `已选择 ${layers.length} 个对象` }}</strong><span>px</span></div>
    <label class="anchor-choice">定位点<select v-model="anchor" aria-label="定位点" :disabled="disabled"><option value="center">中心</option><option value="topleft">左上角</option></select></label>
    <div class="property-fields">
      <label v-for="field in fields" :key="field.key">{{ field.label }}<input v-model="drafts[field.key]" type="text" inputmode="decimal" :aria-label="`${field.label}（原图像素）`" :readonly="!single && (field.key === 'width' || field.key === 'height')" :disabled="disabled" :spellcheck="false" @input="modified.add(field.key)" @blur="commit(field.key)" @keydown.enter.stop.prevent="commit(field.key)" @keydown.esc.stop.prevent="cancel" /></label>
    </div>
    <label v-if="single && !image" class="ratio-choice"><input v-model="lockRatio" type="checkbox" :disabled="disabled" />数值输入保持比例</label>
    <div v-if="!single" class="arrangement-controls" aria-label="排列对象">
      <div class="alignment-buttons"><button v-for="item in alignments" :key="item.key" :aria-label="item.label" :title="item.label" :disabled="disabled" @click="emit('align', item.key)">{{ item.icon }}</button></div>
      <div class="distribution-buttons"><span v-for="item in distributions" :key="item.axis" :title="distributionHint(item.axis)"><button :aria-label="item.label" :disabled="disabled || !distributeSelection(layers, item.axis)" :aria-description="distributionHint(item.axis)" @click="emit('distribute', item.axis)">{{ item.label }}</button></span></div>
    </div>
    <p v-if="error" class="property-error" role="alert">{{ error }}</p>
  </section>
</template>
