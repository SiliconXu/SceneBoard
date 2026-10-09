<script setup lang="ts">
import type { Guides } from './guides'
defineProps<{ guides: Guides; scale: number }>()
</script>

<template>
  <svg class="distance-guides" data-testid="distance-guides" aria-label="图片距离辅助线">
    <line v-for="(line, index) in guides.alignments" :key="`align-${index}`" class="alignment-guide" data-testid="alignment-guide" :x1="line.start.x * scale" :y1="line.start.y * scale" :x2="line.end.x * scale" :y2="line.end.y * scale" />
    <g v-for="line in guides.measurements" :key="line.axis" class="measurement-guide">
      <line :x1="line.start.x * scale" :y1="line.start.y * scale" :x2="line.end.x * scale" :y2="line.end.y * scale" />
      <line v-for="(point, index) in [line.start, line.end]" :key="index" :x1="point.x * scale - (line.axis === 'y' ? 4 : 0)" :y1="point.y * scale - (line.axis === 'x' ? 4 : 0)" :x2="point.x * scale + (line.axis === 'y' ? 4 : 0)" :y2="point.y * scale + (line.axis === 'x' ? 4 : 0)" />
      <g :transform="`translate(${(line.start.x + line.end.x) / 2 * scale + (line.axis === 'y' ? 10 : 0)}, ${(line.start.y + line.end.y) / 2 * scale + (line.axis === 'x' ? -10 : 0)})`">
        <rect x="-3" y="-10" :width="`${String(Math.round(line.distance)).length * 7 + 26}`" height="17" rx="3" />
        <text data-testid="distance-value">{{ Math.round(line.distance) }} px</text>
      </g>
    </g>
  </svg>
</template>
