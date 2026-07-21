<script setup lang="ts">
import type { Metrics } from '~/types/reading'

defineProps<{ metrics: Metrics | null }>()

/** 每项指标一行静态阈值解读，仅帮用户看懂数值，不产 WQI/等级 */
const rows = [
  {
    key: 'tds' as keyof Metrics,
    label: 'TDS',
    unit: 'ppm',
    hint: '<300 安全 · 300-600 一般 · >600 较差',
  },
  {
    key: 'ph' as keyof Metrics,
    label: 'pH',
    unit: '',
    hint: '6.5-8.5 正常 · <6.5 偏酸 · >8.5 偏碱',
  },
  {
    key: 'temperature' as keyof Metrics,
    label: '水温',
    unit: '℃',
    hint: '15-25℃ 适宜多数用途',
  },
  {
    key: 'turbidity' as keyof Metrics,
    label: '浊度',
    unit: 'NTU',
    hint: '<1 清澈 · 1-5 微浊 · >5 浑浊',
  },
  {
    key: 'ec' as keyof Metrics,
    label: '电导率',
    unit: 'μS/cm',
    hint: '<400 低矿化度 · 400-800 中等 · >800 高矿化度',
  },
]
</script>

<template>
  <section class="card">
    <p v-if="!metrics" class="hint">等待数据…（连接水杯或开启 Demo Mode）</p>
    <ul v-else class="grid">
      <li v-for="r in rows" :key="r.key">
        <div class="row-top">
          <span class="label">{{ r.label }}</span>
          <span class="val">{{ metrics[r.key] ?? '-' }} {{ r.unit }}</span>
        </div>
        <span class="hint-text">{{ r.hint }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.card { padding: 16px; border-radius: 8px; border: 1px solid #e0e0e0; }
.grid { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr; gap: 12px; }
.grid li { display: flex; flex-direction: column; gap: 2px; }
.row-top { display: flex; justify-content: space-between; align-items: center; }
.label { color: #555; font-size: 14px; }
.val { font-weight: 600; font-size: 18px; }
.hint-text { color: #999; font-size: 12px; line-height: 1.4; }
.hint { color: #999; text-align: center; }
</style>
