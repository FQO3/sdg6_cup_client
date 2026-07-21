<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReadings } from '~/composables/useReadings'
import type { ReadingRecord } from '~/types/reading'

const { list } = useReadings()
const records = ref<ReadingRecord[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    records.value = await list({ limit: 50 })
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="wrap">
    <h1>历史记录</h1>
    <p v-if="loading">加载中…</p>
    <table v-else>
      <thead>
        <tr><th>时间</th><th>WQI</th><th>等级</th><th>TDS</th><th>pH</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in records" :key="r.id">
          <td>{{ new Date(r.measured_at).toLocaleString() }}</td>
          <td>{{ r.wqi }}</td>
          <td>{{ r.level }}</td>
          <td>{{ r.metrics.tds ?? '-' }}</td>
          <td>{{ r.metrics.ph ?? '-' }}</td>
        </tr>
      </tbody>
    </table>
    <NuxtLink to="/">← 返回检测</NuxtLink>
  </main>
</template>

<style scoped>
.wrap { max-width: 720px; margin: 0 auto; padding: 24px; font-family: system-ui; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; }
th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
</style>
