<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useBle } from '~/composables/useBle'
import { useDemo, localLevelFallback } from '~/composables/useWqi'
import { useReadings } from '~/composables/useReadings'
import type { Metrics, ReadingResult } from '~/types/reading'

const config = useRuntimeConfig()
const ble = useBle()
const demo = useDemo()
const { submit } = useReadings()

const demoOn = ref(config.public.demoMode)

// 当前指标来源：Demo 优先，否则 BLE
const metrics = computed<Metrics | null>(() =>
  demoOn.value ? demo.metrics.value : ble.metrics.value,
)

// 即时本地判级（仅 UI 反馈，非权威）
const localLevel = computed(() => (metrics.value ? localLevelFallback(metrics.value) : null))

const result = ref<ReadingResult | null>(null)
const submitting = ref(false)

watch(demoOn, (on) => (on ? demo.start() : demo.stop()))

async function onSubmit() {
  if (!metrics.value) return
  submitting.value = true
  try {
    const pos = await getPosition()
    result.value = await submit({
      device_id: ble.deviceName.value || 'demo-device',
      location: { lat: pos.lat, lng: pos.lng },
      metrics: metrics.value,
      measured_at: new Date().toISOString(),
    })
  } finally {
    submitting.value = false
  }
}

function getPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: 0, lng: 0 })
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: 0, lng: 0 }),
    )
  })
}
</script>

<template>
  <main class="wrap">
    <h1>{{ config.public.appName }} · 水质检测</h1>

    <section class="bar">
      <label><input type="checkbox" v-model="demoOn" /> Demo Mode（无硬件模拟）</label>
      <template v-if="!demoOn">
        <button v-if="!ble.connected.value" @click="ble.connect">连接水杯 (BLE)</button>
        <button v-else @click="ble.disconnect">断开 · {{ ble.deviceName.value }}</button>
      </template>
      <p v-if="ble.error.value" class="err">{{ ble.error.value }}</p>
    </section>

    <MetricCard :metrics="metrics" :level="localLevel" />

    <button class="primary" :disabled="!metrics || submitting" @click="onSubmit">
      {{ submitting ? '上报中…' : '上报并评估' }}
    </button>

    <section v-if="result" class="result" :data-level="result.level">
      <h2>后端评估结果</h2>
      <p>WQI：<b>{{ result.wqi }}</b> / 100</p>
      <p>等级：<b>{{ result.level }}</b></p>
    </section>

    <NuxtLink to="/history">查看历史 →</NuxtLink>
  </main>
</template>

<style scoped>
.wrap { max-width: 640px; margin: 0 auto; padding: 24px; font-family: system-ui; }
.bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 16px 0; }
.err { color: #c0392b; }
.primary { padding: 10px 20px; margin: 16px 0; }
.result { padding: 16px; border-radius: 8px; background: #f5f5f5; }
.result[data-level='safe'] { background: #e8f5e9; }
.result[data-level='warning'] { background: #fff8e1; }
.result[data-level='danger'] { background: #ffebee; }
</style>
