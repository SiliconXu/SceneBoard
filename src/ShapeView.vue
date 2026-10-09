<script setup lang="ts">
import { computed } from 'vue'
import type { ShapeLayer } from './project'
const props = defineProps<{ shape: ShapeLayer }>()
const stroke = computed(() => Math.min(2, props.shape.width, props.shape.height))
</script>

<template>
  <svg class="shape-svg" :viewBox="`0 0 ${Math.max(1, shape.width)} ${Math.max(1, shape.height)}`" aria-hidden="true">
    <rect v-if="shape.kind === 'rectangle'" :x="stroke / 2" :y="stroke / 2" :width="Math.max(0, shape.width - stroke)" :height="Math.max(0, shape.height - stroke)" :fill="shape.fillColor || 'none'" fill-opacity="0.25" :stroke="shape.color" :stroke-width="stroke" />
    <ellipse v-else :cx="shape.width / 2" :cy="shape.height / 2" :rx="Math.max(0, (shape.width - stroke) / 2)" :ry="Math.max(0, (shape.height - stroke) / 2)" :fill="shape.fillColor || 'none'" fill-opacity="0.25" :stroke="shape.color" :stroke-width="stroke" />
  </svg>
</template>
