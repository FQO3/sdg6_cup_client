<script setup lang="ts">
import type { Metrics, WaterLevel } from '~/types/reading'

defineProps<{ metrics: Metrics | null; level: WaterLevel | null }>()

const rows: { key: keyof Metrics; label: string; unit: string }[] = [
  { key: 'tds', label: 'TDS', unit: 'ppm' },
  { key: 'ph', label: 'pH', unit: '' },
  { key: 'temperature', label: '水温', unit: '℃' },
  { key: 'turbidity', label: '浊度', unit: 'NTU' },
  { key: 'ec', label: '电导率', unit: 'μS/cm' },
]
</script>

<template>
  <section class="card" :data-level="level ?? ''">
    <p v-if="!metrics" class="hint">等待数据…（连接水杯或开启 Demo Mode）</p>
    <ul v-else class="grid">
      <li v-for="r in rows" :key="r.key">
        <span class="label">{{ r.label }}</span>
        <span class="val">{{ metrics[r.key] ?? '-' }} {{ r.unit }}</span>
      </li>
    </ul>
    <p v-if="level" class="local">本地初判：{{ level }}（以后端结果为准）</p>
  </section>
</template>

<style scoped>
.card { padding: 16px; border-radius: 8px; border: 1px solid #eee; }
.card[data-level='safe'] { border-color: #66bb6a; }
.card[data-level='warning'] { border-color: #ffb300; }
.card[data-level='danger'] { border-color: #ef5350; }
.grid { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.grid li { display: flex; justify-content: space-between; }
.label { color: #666; }
.val { font-weight: 600; }
.hint { color: #999; }
.local { color: #888; font-size: 12px; margin-top: 8px; }
</style>
