<script setup lang="ts">
import type { Metrics } from '~/types/reading'

defineProps<{ metrics: Metrics | null }>()

/**
 * MetricCard：每项传感器读数 + 科普提示。
 * ─ 前 4 行（temperature, ph, ec, turbidity）= 随机森林模型输入
 * ─ 第 5 行（tds）= 补充参考（不参与判级，由 ec 换算可得）
 */
const rows = [
  {
    key: 'temperature' as keyof Metrics,
    label: '水温',
    unit: '℃',
    hint: '随机森林输入参数① · 正常 10-35℃',
    isModel: true,
  },
  {
    key: 'ph' as keyof Metrics,
    label: 'pH',
    unit: '',
    hint: '随机森林输入参数② · GB 3838 要求 6-9',
    isModel: true,
  },
  {
    key: 'ec' as keyof Metrics,
    label: '电导率',
    unit: 'μS/cm',
    hint: '随机森林输入参数③ · MI 最高特征 (0.475 bits)',
    isModel: true,
  },
  {
    key: 'turbidity' as keyof Metrics,
    label: '浊度',
    unit: 'NTU',
    hint: '随机森林输入参数④ · <5 较清澈 / 5-50 浑浊 / >50 严重浑浊',
    isModel: true,
  },
  {
    key: 'tds' as keyof Metrics,
    label: 'TDS',
    unit: 'ppm',
    hint: '补充参考（≈ 0.64× 电导率）· <300 低矿化度 · 300-600 中等 · >600 高矿化度',
    isModel: false,
  },
]
</script>

<template>
  <section class="card">
    <p v-if="!metrics" class="hint">等待数据…（连接水杯或开启 Demo Mode）</p>
    <ul v-else class="grid">
      <li v-for="r in rows" :key="r.key" :class="{ model: r.isModel }">
        <div class="row-top">
          <span class="label">
            {{ r.label }}
            <sup v-if="r.isModel" class="model-badge">模型输入</sup>
          </span>
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
.grid li { display: flex; flex-direction: column; gap: 2px; padding: 4px 8px; border-radius: 4px; }
.grid li.model { background: #f3f9ff; border-left: 3px solid #42a5f5; }
.row-top { display: flex; justify-content: space-between; align-items: center; }
.label { color: #555; font-size: 14px; }
.model-badge { font-size: 10px; color: #1976d2; background: #e3f2fd; padding: 1px 5px; border-radius: 3px; margin-left: 4px; }
.val { font-weight: 600; font-size: 18px; }
.hint-text { color: #999; font-size: 12px; line-height: 1.4; }
.hint { color: #999; text-align: center; }
</style>
