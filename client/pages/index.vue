<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useBle } from '~/composables/useBle'
import { useDemo, demoLevelFallback } from '~/composables/useWqi'
import { useEvaluate } from '~/composables/useEvaluate'
import { useReports } from '~/composables/useReports'
import type { Metrics, ReportPayload } from '~/types/reading'

const config = useRuntimeConfig()
const ble = useBle()
const demo = useDemo()
const { submit } = useReports()

const demoOn = ref(config.public.demoMode)

// ───── 链路 A：实时判级 ─────

/** Demo 模式用模拟数据，BLE 模式用真实聚合数据触发 /evaluate */
const batchedSource = computed<Metrics | null>(() =>
  demoOn.value ? demo.metrics.value : ble.batchedMetrics.value,
)

/** 链路 A 判级 composable：监听 batchedSource 自动调 /evaluate */
const evaluate = useEvaluate(batchedSource)

/** Demo 模式：本地简化判级，不调后端 */
const demoEval = computed(() =>
  demo.metrics.value ? demoLevelFallback(demo.metrics.value) : null,
)

/** 当前显示的水质等级/WQI：Demo 用本地，BLE 用后端 /evaluate */
const displayLevel = computed(() =>
  demoOn.value ? demoEval.value?.level ?? null : evaluate.result.value?.level ?? null,
)
const displayWqi = computed(() =>
  demoOn.value ? demoEval.value?.wqi ?? null : evaluate.result.value?.wqi ?? null,
)

// ───── 链路 B：提交报告 ─────

const userNote = ref('')
const submitting = ref(false)
const reportResult = ref<Awaited<ReturnType<typeof submit>> | null>(null)

/** MetricCard 展示用：Demo 用 demo.metrics，BLE 用最近单帧 rawMetrics */
const displayMetrics = computed<Metrics | null>(() =>
  demoOn.value ? demo.metrics.value : ble.rawMetrics.value,
)

// Demo 开关联动
watch(demoOn, (on) => (on ? demo.start() : demo.stop()))

async function onSubmit() {
  const m = displayMetrics.value
  if (!m) return
  submitting.value = true
  reportResult.value = null
  try {
    const pos = await getPosition()
    const region = await reverseGeocode(pos.lat, pos.lng)
    const payload: ReportPayload = {
      device_id: ble.deviceName.value || 'demo-device',
      location: { lat: pos.lat, lng: pos.lng, region },
      metrics: m,
      user_note: userNote.value || undefined,
      measured_at: new Date().toISOString(),
    }
    reportResult.value = await submit(payload)
  } catch (e: any) {
    // 不存本地缓存，提示重试
    alert('上报失败：' + (e?.message ?? '网络异常，请重试'))
  } finally {
    submitting.value = false
  }
}

async function getPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: 0, lng: 0 })
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: 0, lng: 0 }),
      { timeout: 5000 },
    )
  })
}

/** 反地理编码（用免费 Nominatim API） */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await $fetch<{ display_name?: string }>(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`,
    )
    return res?.display_name ?? '未知区域'
  } catch {
    return '未知区域'
  }
}
</script>

<template>
  <main class="wrap">
    <h1>{{ config.public.appName }} · 水质检测</h1>

    <!-- ═══ 连接区 ═══ -->
    <section class="bar">
      <label><input type="checkbox" v-model="demoOn" /> Demo Mode（无硬件模拟）</label>
      <template v-if="!demoOn">
        <button v-if="!ble.connected.value" @click="ble.connect">
          {{ ble.supported.value ? '连接水杯 (BLE)' : 'BLE 不可用' }}
        </button>
        <button v-else @click="ble.disconnect">
          断开 · {{ ble.deviceName.value }}
        </button>
      </template>
      <p v-if="ble.error.value" class="err">{{ ble.error.value }}</p>
    </section>

    <!-- ═══ 水位 / 连接状态 ═══ -->
    <p v-if="!demoOn && ble.connected.value" class="wet">
      {{ displayMetrics?.wet ? '✅ 水杯已浸没' : '⚠️ 水杯未浸入水中，请浸没后检测' }}
    </p>

    <!-- ═══ 指标卡片 + 实时判级 ═══ -->
    <MetricCard :metrics="displayMetrics" />

    <section
      v-if="displayLevel"
      class="eval"
      :data-level="displayLevel"
    >
      <h2>实时水质评估</h2>
      <p>WQI：<b>{{ displayWqi }}</b> / 100</p>
      <p>等级：<b>{{ displayLevel }}</b></p>
      <small v-if="!demoOn">（每 3 帧评测一次，仅供参考）</small>
      <small v-else>（Demo 本地简化判级）</small>
    </section>

    <!-- ═══ 提交报告区 ═══ -->
    <section class="report-section">
      <h2>提交检测报告</h2>
      <textarea
        v-model="userNote"
        placeholder="备注（可选）：如取样地点、水体类型、异味/颜色等观察"
        rows="2"
        class="note-input"
      />
      <button class="primary" :disabled="!displayMetrics || submitting" @click="onSubmit">
        {{ submitting ? '提交中…' : '提交报告（入库 ⬆）' }}
      </button>
    </section>

    <section v-if="reportResult" class="result" :data-level="reportResult.level">
      <h2>报告已提交</h2>
      <p>ID：<b>{{ reportResult.report_id }}</b></p>
      <p>WQI：<b>{{ reportResult.wqi }}</b> / 100 · 等级：<b>{{ reportResult.level }}</b></p>
      <details v-if="reportResult.llm_report">
        <summary>LLM 分析报告</summary>
        <div class="llm" v-html="reportResult.llm_report" />
      </details>
    </section>

    <NuxtLink to="/history">查看历史记录 →</NuxtLink>
  </main>
</template>

<style scoped>
.wrap { max-width: 640px; margin: 0 auto; padding: 24px; font-family: system-ui; }
.bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 16px 0; }
.err { color: #c0392b; }
.wet { padding: 8px 12px; border-radius: 6px; background: #e8f5e9; font-size: 14px; }
.wet:has(text:contains('未')) { background: #fff3e0; }
.primary { padding: 10px 20px; margin: 16px 0; }
.eval { padding: 16px; border-radius: 8px; background: #f5f5f5; margin: 16px 0; }
.eval[data-level='safe'] { background: #e8f5e9; }
.eval[data-level='warning'] { background: #fff8e1; }
.eval[data-level='danger'] { background: #ffebee; }
.report-section { margin: 24px 0; padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; }
.note-input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; resize: vertical; }
.result { padding: 16px; border-radius: 8px; background: #f5f5f5; margin: 16px 0; }
.result[data-level='safe'] { background: #e8f5e9; }
.result[data-level='warning'] { background: #fff8e1; }
.result[data-level='danger'] { background: #ffebee; }
.llm { white-space: pre-wrap; font-size: 14px; margin-top: 8px; }
small { display: block; color: #888; margin-top: 4px; }
</style>
