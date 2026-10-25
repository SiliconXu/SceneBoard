<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import type { AnimationGroup } from './project'
import { animationSize, drawAnimationFrame } from './animation'
import { decodeImage } from './files'

const props = defineProps<{ group: AnimationGroup; index: number }>()
const canvas = ref<HTMLCanvasElement>()
const size = computed(() => animationSize(props.group))
const cache = new Map<string, Promise<HTMLImageElement>>()
const error = ref('')
watchEffect(onCleanup => {
  const element = canvas.value, frame = props.group.frames[props.index], bounds = size.value
  let cancelled = false
  onCleanup(() => { cancelled = true })
  if (!element || !frame) return
  const ratio = Math.min(4, 520 / bounds.width, 160 / bounds.height)
  element.width = Math.max(1, Math.round(bounds.width * ratio)); element.height = Math.max(1, Math.round(bounds.height * ratio))
  if (!cache.has(frame.src)) cache.set(frame.src, decodeImage(frame.src))
  void cache.get(frame.src)!.then(image => {
    if (cancelled) return
    const ctx = element.getContext('2d')!
    ctx.clearRect(0, 0, element.width, element.height)
    drawAnimationFrame(ctx, image, frame, bounds, { width: element.width, height: element.height })
    error.value = ''
  }).catch(cause => { if (!cancelled) error.value = (cause as Error).message })
})
</script>

<template><div class="animation-preview" aria-label="动画预览"><canvas ref="canvas" :data-frame-id="group.frames[index]?.id" :data-frame-index="index" role="img" :aria-label="`第 ${index + 1} 帧`"></canvas><span v-if="error" role="alert">{{ error }}</span></div></template>
