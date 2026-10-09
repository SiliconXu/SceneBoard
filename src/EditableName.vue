<script setup lang="ts">
import { nextTick, ref } from 'vue'
const props = defineProps<{ name: string; disabled: boolean }>()
const emit = defineEmits<{ rename: [name: string]; select: []; editing: [active: boolean] }>()
const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement>()

async function begin() {
  if (props.disabled) return
  draft.value = props.name
  editing.value = true
  emit('select')
  emit('editing', true)
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
function finish(save: boolean) {
  if (!editing.value) return
  editing.value = false
  if (save && !props.disabled && draft.value !== props.name) emit('rename', draft.value)
  emit('editing', false)
}
</script>

<template>
  <div class="inline-name" @click.stop @pointerdown.stop @dragstart.stop.prevent>
    <input v-if="editing" ref="input" v-model="draft" aria-label="角色 / 物品名称" autocomplete="off" :spellcheck="false" :disabled="disabled" @keydown.enter.stop.prevent="finish(true)" @keydown.esc.stop.prevent="finish(false)" @blur="finish(true)" />
    <button v-else class="edit-name" data-testid="edit-name" :disabled="disabled" :title="`点击修改名称：${name || '未命名对象'}`" @click="begin">{{ name || '未命名对象' }}</button>
  </div>
</template>
