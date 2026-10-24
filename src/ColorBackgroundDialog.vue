<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { assertCanvasSize, validColor } from './background'
import type { ColorBackground } from './project'
const props = defineProps<{ current?: ColorBackground }>()
const emit = defineEmits<{ close: []; apply: [background: ColorBackground] }>()
const width = ref(props.current?.width ?? 800)
const height = ref(props.current?.height ?? 600)
const color = ref(props.current?.color ?? '#000000')
const error = ref('')
const firstInput = ref<HTMLInputElement>()
const pickerColor = computed(() => validColor(color.value) ? color.value : '#000000')
onMounted(() => firstInput.value?.focus())
function apply() {
  try {
    assertCanvasSize({ width: Number(width.value), height: Number(height.value) })
    if (!validColor(color.value)) throw new Error('请输入六位十六进制颜色，例如 #000000。')
    emit('apply', { kind: 'color', name: '纯色背景', width: Number(width.value), height: Number(height.value), color: color.value.toLowerCase() })
  } catch (cause) { error.value = (cause as Error).message }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')" @keydown.esc.stop="emit('close')">
    <form class="modal background-dialog" role="dialog" aria-modal="true" aria-labelledby="color-title" @submit.prevent="apply">
      <h2 id="color-title">{{ current ? '修改背景颜色' : '创建纯色背景' }}</h2>
      <p>{{ current ? '修改颜色会保留所有图层。' : '设置画布大小后，即可添加角色，无需导入背景图片。' }}</p>
      <div class="dimension-inputs">
        <label>宽度（px）<input ref="firstInput" v-model.number="width" aria-label="画布宽度" type="number" min="1" max="32767" step="1" required :disabled="!!current" /></label>
        <label>高度（px）<input v-model.number="height" aria-label="画布高度" type="number" min="1" max="32767" step="1" required :disabled="!!current" /></label>
      </div>
      <label class="color-inputs">背景颜色<input type="color" aria-label="背景颜色选择器" :value="pickerColor" @input="color = ($event.target as HTMLInputElement).value" /><input v-model="color" aria-label="背景颜色值" type="text" maxlength="7" placeholder="#000000" required /></label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <div class="modal-actions"><button class="button" type="button" @click="emit('close')">取消</button><button class="button primary" type="submit">{{ current ? '应用颜色' : '创建画布' }}</button></div>
    </form>
  </div>
</template>
