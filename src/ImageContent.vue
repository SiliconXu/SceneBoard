<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { decodeImage } from './files'
import { drawImageContent } from './image-processing'
import type { ImageLayer } from './project'

const props = defineProps<{ layer: ImageLayer; thumbnail?: boolean }>()
const canvas = ref<HTMLCanvasElement>()
const error = ref('')
watchEffect(onCleanup => {
  const element = canvas.value
  const { src, crop, flipX, flipY, width, height } = props.layer
  const thumbnail = props.thumbnail
  let cancelled = false
  onCleanup(() => { cancelled = true })
  if (!element) return
  void decodeImage(src).then(image => {
    if (cancelled) return
    // Match the scene export pixel size; small thumbnails need no large allocation.
    const ratio = Math.min(1, (thumbnail ? 76 : 2048) / width, (thumbnail ? 76 : 2048) / height)
    element.width = Math.max(1, Math.round(width * ratio)); element.height = Math.max(1, Math.round(height * ratio))
    const context = element.getContext('2d')!
    context.imageSmoothingQuality = 'high'
    drawImageContent(context, image, { crop, flipX, flipY }, { x: 0, y: 0, width: element.width, height: element.height })
    error.value = ''
  }).catch(cause => { if (!cancelled) error.value = (cause as Error).message })
})
</script>

<template><canvas ref="canvas" class="image-content" role="img" :aria-label="layer.name" :title="error || undefined"></canvas></template>
