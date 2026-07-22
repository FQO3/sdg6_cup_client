<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useBle } from '~/composables/useBle'
import { useDemo, demoLevelFallback } from '~/composables/useWqi'
import { useEvaluate } from '~/composables/useEvaluate'
import { useCapture } from '~/composables/useCapture'
import { useReports } from '~/composables/useReports'
import type { Metrics, GBGrade, WaterType, ReportPayload } from '~/types/reading'
import {
  GB_GRADE_LABELS,
  GB_GRADE_TAGLINES,
  WATER_TYPE_ORDER,
  WATER_TYPE_LABELS,
} from '~/types/reading'

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

/** 当前设备 ID：Demo 用固定名，BLE 用真实设备名 */
const deviceId = computed(() =>
  demoOn.value ? 'demo-device' : (ble.deviceName.value || 'unknown'),
)

/** 链路 A 判级 composable：监听 batchedSource 自动调 /evaluate */
const evaluate = useEvaluate(batchedSource, deviceId)

/** Demo 模式：本地简化判级，不调后端 */
const demoEval = computed(() =>
  demo.metrics.value ? demoLevelFallback(demo.metrics.value) : null,
)

/** 当前显示的 GB 等级：Demo 用本地，BLE 用 Pipeline 返回 */
const displayGrade = computed<GBGrade | null>(() =>
  demoOn.value ? demoEval.value?.grade ?? null : evaluate.result.value?.grade ?? null,
)
const displayGradeIndex = computed<number | null>(() =>
  demoOn.value ? demoEval.value?.grade_index ?? null : evaluate.result.value?.grade_index ?? null,
)
const displayConfidence = computed<number | null>(() =>
  demoOn.value ? demoEval.value?.confidence ?? null : evaluate.result.value?.confidence ?? null,
)

// ───── 6 色方案（GB 等级背景色） ─────
const GRADE_COLORS: Record<number, { bg: string; text: string }> = {
  0: { bg: '#e3f2fd', text: '#1565c0' },   // Ⅰ类 — 深蓝
  1: { bg: '#e8f4fd', text: '#42a5f5' },   // Ⅱ类 — 亮蓝
  2: { bg: '#e8f5e9', text: '#2e7d32' },   // Ⅲ类 — 绿色
  3: { bg: '#fff8e1', text: '#f57f17' },   // Ⅳ类 — 琥珀
  4: { bg: '#fff3e0', text: '#e65100' },   // Ⅴ类 — 橙色
  5: { bg: '#ffebee', text: '#c62828' },   // 劣Ⅵ类 — 红色
}

/** MetricCard 展示用：Demo 用 demo.metrics，BLE 用最近单帧 rawMetrics */
const displayMetrics = computed<Metrics | null>(() =>
  demoOn.value ? demo.metrics.value : ble.rawMetrics.value,
)

// Demo 开关联动
watch(demoOn, (on) => (on ? demo.start() : demo.stop()))

/** Demo 数据模式：random=全随机（跳跃）；stable=小幅摆动（可进入稳定态测试采集） */
const demoStable = ref(false)
watch(demoStable, (on) => demo.setMode(on ? 'stable' : 'random'))

// ───── 链路 B：采集状态机 → 提交报告 ─────

/** 采集状态机：start() 后连续检测 → 判稳 → 去离散 → 收满 20 条有效样本 */
const capture = useCapture(batchedSource, deviceId)

/** 采集完成后才展示的表单字段 */
const userNote = ref('')
const waterType = ref<WaterType | null>(null)
const authenticityConfirmed = ref(false)

const submitting = ref(false)
const reportResult = ref<Awaited<ReturnType<typeof submit>> | null>(null)

/** 是否允许提交：采集完成 + 已勾选真实性 + 已选水体类型 */
const canSubmit = computed(
  () =>
    capture.status.value === 'done' &&
    !!capture.aggregate.value &&
    authenticityConfirmed.value &&
    !!waterType.value &&
    !submitting.value,
)

/** 开始记录：清空上一轮表单与结果，启动采集 */
function onStartCapture() {
  userNote.value = ''
  waterType.value = null
  authenticityConfirmed.value = false
  reportResult.value = null
  capture.start()
}

async function onSubmit() {
  const agg = capture.aggregate.value
  if (!agg || !authenticityConfirmed.value || !waterType.value) return
  submitting.value = true
  reportResult.value = null
  try {
    const pos = await getPosition()
    const region = await reverseGeocode(pos.lat, pos.lng)
    const payload: ReportPayload = {
      device_id: deviceId.value,
      location: { lat: pos.lat, lng: pos.lng, region },
      metrics: agg.metrics,
      water_type: waterType.value,
      authenticity_confirmed: authenticityConfirmed.value,
      capture: agg,
      user_note: userNote.value || undefined,
      measured_at: new Date().toISOString(),
    }
    reportResult.value = await submit(payload)
    // 提交成功后收起采集流程，回到初始态
    capture.cancel()
  } catch (e: any) {
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
      <label v-if="demoOn" class="sub">
        <input type="checkbox" v-model="demoStable" /> 稳定数据（小幅摆动，可测采集稳定态）
      </label>
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
      v-if="displayGrade"
      class="eval"
      :style="{
        background: GRADE_COLORS[displayGradeIndex ?? 3]?.bg ?? '#f5f5f5',
        borderLeft: `4px solid ${GRADE_COLORS[displayGradeIndex ?? 3]?.text ?? '#999'}`,
      }"
    >
      <h2>实时水质评估（GB 3838-2002）</h2>
      <p class="grade-text" :style="{ color: GRADE_COLORS[displayGradeIndex ?? 3]?.text }">
        <b>{{ displayGrade }} - {{ GB_GRADE_TAGLINES[displayGrade] }}</b>
      </p>
      <p class="grade-desc">{{ GB_GRADE_LABELS[displayGrade] }}</p>
      <p v-if="displayConfidence != null" class="confidence">
        模型置信度：<b>{{ (displayConfidence * 100).toFixed(2) }}%</b>
      </p>
      <small v-if="!demoOn">（每 3 帧评测一次，随机森林模型 · 仅供参考）</small>
      <small v-else>（Demo 本地简化判级）</small>
    </section>

    <!-- ═══ 采集 / 提交报告区 ═══ -->
    <section class="report-section">
      <h2>提交检测报告</h2>

      <!-- 阶段 0：idle — 开始记录 -->
      <template v-if="capture.status.value === 'idle'">
        <p class="hint">
          点击「开始记录」后将连续检测水质，待读数基本稳定并去除离散数据后，
          自动收集 {{ capture.target }} 条有效样本。
        </p>
        <button class="primary" :disabled="!displayMetrics" @click="onStartCapture">
          {{ displayMetrics ? '开始记录' : '等待水质数据…' }}
        </button>
      </template>

      <!-- 阶段 1：collecting — 进度 -->
      <template v-else-if="capture.status.value === 'collecting'">
        <p class="cap-stage">
          {{ capture.stableReached.value ? '✅ 水质已基本稳定，正在采集有效样本…' : '⏳ 正在等待水质稳定…' }}
        </p>
        <div class="cap-bar">
          <div class="cap-bar-fill" :style="{ width: (capture.progress.value * 100).toFixed(0) + '%' }" />
        </div>
        <p class="cap-meta">
          有效样本 <b>{{ capture.collected.value }} / {{ capture.target }}</b>
          · 已检测 {{ capture.totalReadings.value }} 次
          · 丢弃离散 {{ capture.discarded.value }} 条
        </p>
        <button class="ghost" @click="capture.cancel">取消采集</button>
      </template>

      <!-- 阶段 error -->
      <template v-else-if="capture.status.value === 'error'">
        <p class="err">{{ capture.errorMsg.value }}</p>
        <button class="primary" :disabled="!displayMetrics" @click="onStartCapture">重新开始记录</button>
      </template>

      <!-- 阶段 2：done — 附加信息表单 -->
      <template v-else-if="capture.status.value === 'done' && capture.aggregate.value">
        <p class="cap-stage">
          ✅ 采集完成：共 {{ capture.aggregate.value.raw_samples.length }} 条有效样本
          · 判级 <b>{{ capture.aggregate.value.grade }}</b>
          （一致率 {{ (capture.aggregate.value.grade_agreement * 100).toFixed(0) }}%）
        </p>

        <label class="field-label">水体类型（必选）</label>
        <div class="water-types">
          <label v-for="wt in WATER_TYPE_ORDER" :key="wt" class="wt-opt">
            <input type="radio" name="waterType" :value="wt" v-model="waterType" />
            {{ WATER_TYPE_LABELS[wt] }}
          </label>
        </div>

        <label class="field-label">附加说明（可选）</label>
        <textarea
          v-model="userNote"
          placeholder="如取样地点、异味/颜色等观察"
          rows="2"
          class="note-input"
        />

        <label class="confirm">
          <input type="checkbox" v-model="authenticityConfirmed" />
          我确认本次上传的是<b>真实采集的水体数据</b>，未经伪造。
        </label>

        <button class="primary" :disabled="!canSubmit" @click="onSubmit">
          {{ submitting ? '提交中…' : '提交报告（入库 ⬆）' }}
        </button>
        <button class="ghost" :disabled="submitting" @click="capture.cancel">放弃本次采集</button>
      </template>
    </section>

    <section
      v-if="reportResult"
      class="result"
      :style="{
        background: GRADE_COLORS[reportResult.grade_index]?.bg ?? '#f5f5f5',
        borderLeft: `4px solid ${GRADE_COLORS[reportResult.grade_index]?.text ?? '#999'}`,
      }"
    >
      <h2>报告已提交</h2>
      <p>ID：<b>{{ reportResult.report_id }}</b></p>
      <p>等级：<b>{{ reportResult.grade }}</b> · {{ GB_GRADE_LABELS[reportResult.grade] }}</p>
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
.sub { font-size: 13px; color: #555; }
.err { color: #c0392b; }
.wet { padding: 8px 12px; border-radius: 6px; background: #e8f5e9; font-size: 14px; }

.primary { padding: 10px 20px; margin: 16px 0; }

.eval { padding: 16px; border-radius: 8px; margin: 16px 0; }
.grade-text { font-size: 36px; margin: 8px 0; }
.grade-desc { font-size: 14px; color: #555; margin: 4px 0; }
.confidence { font-size: 13px; color: #888; }

.report-section { margin: 24px 0; padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; }
.note-input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; resize: vertical; }

.hint { font-size: 13px; color: #666; margin: 4px 0 8px; }
.ghost { padding: 8px 16px; margin: 8px 8px 0 0; background: none; border: 1px solid #bbb; border-radius: 4px; cursor: pointer; }
.cap-stage { font-size: 14px; margin: 4px 0 8px; }
.cap-meta { font-size: 13px; color: #555; margin: 8px 0; }
.cap-bar { height: 10px; border-radius: 5px; background: #eee; overflow: hidden; }
.cap-bar-fill { height: 100%; background: #2e86de; transition: width .3s ease; }
.field-label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
.water-types { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.wt-opt { font-size: 14px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.confirm { display: flex; align-items: flex-start; gap: 6px; font-size: 14px; margin: 12px 0; }

.result { padding: 16px; border-radius: 8px; margin: 16px 0; }

.llm { white-space: pre-wrap; font-size: 14px; margin-top: 8px; }
small { display: block; color: #888; margin-top: 4px; }
</style>
