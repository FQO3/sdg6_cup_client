<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useBle } from '~/composables/useBle'
import { useDemo } from '~/composables/useWqi'
import { useEvaluate } from '~/composables/useEvaluate'
import { useCapture } from '~/composables/useCapture'
import { useReports } from '~/composables/useReports'
import { ratingTimeline } from '~/composables/useRatingHistory'
import type { Metrics, GBGrade, WaterType, ReportPayload, ReportRecord } from '~/types/reading'
import {
  GB_GRADE_ORDER,
  GB_GRADE_LABELS,
  GB_GRADE_TAGLINES,
  WATER_TYPE_ORDER,
  WATER_TYPE_LABELS,
} from '~/types/reading'

const config = useRuntimeConfig()
const ble = useBle()
const demo = useDemo()
const { submit, list } = useReports()

const demoOn = ref(config.public.demoMode)

// ───── 页面导航 / 锚点 ─────
const navItems = [
  { id: 'hero', icon: '💧', label: '实时概览' },
  { id: 'evaluation', icon: '🧪', label: '水质评价' },
  { id: 'sensor-data', icon: '📟', label: '传感器数据' },
  { id: 'capture-report', icon: '📝', label: '提交报告' },
  { id: 'trend-chart', icon: '📈', label: '判级趋势' },
  { id: 'reports', icon: '🕘', label: '历史记录' },
] as const

type NavSectionId = (typeof navItems)[number]['id']

const activeSection = ref<NavSectionId>('hero')
const sensorExpanded = ref(false)

function scrollToSection(id: NavSectionId) {
  const el = document.getElementById(id)
  if (!el) return
  activeSection.value = id
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function updateActiveSection() {
  const offset = 150
  let current: NavSectionId = navItems[0].id
  for (const item of navItems) {
    const el = document.getElementById(item.id)
    if (!el) continue
    if (el.getBoundingClientRect().top <= offset) current = item.id
  }
  activeSection.value = current
}

// ───── 链路 A：实时判级 ─────

/** Demo 模式用模拟聚合数据，BLE 模式用真实聚合数据触发 /evaluate */
const batchedSource = computed<Metrics | null>(() =>
  demoOn.value ? demo.batchedMetrics.value : ble.batchedMetrics.value,
)

/** 当前设备 ID：Demo 用固定名，BLE 用真实设备名 */
const deviceId = computed(() =>
  demoOn.value ? 'demo-device' : (ble.deviceName.value || 'unknown'),
)

/** 链路 A 判级 composable：监听 batchedSource 自动调 /evaluate */
const evaluate = useEvaluate(batchedSource, deviceId)

/** 当前显示的 GB 等级：Demo 和 BLE 均来自统一 Pipeline 返回 */
const displayGrade = computed<GBGrade | null>(() => evaluate.result.value?.grade ?? null)
const displayGradeIndex = computed<number | null>(() => evaluate.result.value?.grade_index ?? null)
const displayConfidence = computed<number | null>(() => evaluate.result.value?.confidence ?? null)

// ───── 6 色方案（GB 等级背景色） ─────
const GRADE_COLORS: Record<number, { bg: string; text: string }> = {
  0: { bg: '#e3f2fd', text: '#1565c0' },   // Ⅰ类 — 深蓝
  1: { bg: '#e8f4fd', text: '#42a5f5' },   // Ⅱ类 — 亮蓝
  2: { bg: '#e8f5e9', text: '#2e7d32' },   // Ⅲ类 — 绿色
  3: { bg: '#fff8e1', text: '#f57f17' },   // Ⅳ类 — 琥珀
  4: { bg: '#fff3e0', text: '#e65100' },   // Ⅴ类 — 橙色
  5: { bg: '#ffebee', text: '#c62828' },   // 劣Ⅵ类 — 红色
}

function gradeColor(gradeIndex: number): string {
  return GRADE_COLORS[gradeIndex]?.text ?? '#8ba8b7'
}

/** MetricCard 展示用：Demo 用 demo.metrics，BLE 用最近单帧 rawMetrics */
const displayMetrics = computed<Metrics | null>(() =>
  demoOn.value ? demo.metrics.value : ble.rawMetrics.value,
)

// Demo 开关联动
watch(demoOn, (on) => (on ? demo.start() : demo.stop()), { immediate: true })

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
    await loadReports()
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

/** 逆地理编码：调用 BFF 代理 /api/geocode（高德 regeo REST API），返回 formatted_address 即当前所处地点 */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  if (!lat || !lng) return '未知区域'
  try {
    const res = await $fetch<{ formatted_address: string }>('/api/geocode', {
      query: { lat, lng },
    })
    return res.formatted_address || '未知区域'
  } catch {
    return '未知区域'
  }
}

// ───── 历史报告列表 ─────
const reports = ref<ReportRecord[]>([])
const loading = ref(true)
const reportError = ref('')

async function loadReports() {
  loading.value = true
  reportError.value = ''
  try {
    reports.value = await list({ page: '1', page_size: '20' })
  } catch {
    reportError.value = '加载失败，请检查网络'
  } finally {
    loading.value = false
  }
}

// ───── 判级时间折线图 (Canvas) ─────
const canvasRef = ref<HTMLCanvasElement | null>(null)
const GAP_THRESHOLD_MS = 30_000

function drawChart() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const pts = ratingTimeline.value.filter((p) => !p.isGap)
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth || 640
  const H = canvas.clientHeight || 300
  canvas.width = W * dpr
  canvas.height = H * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const pad = { top: 26, right: 18, bottom: 42, left: 54 }
  const cw = W - pad.left - pad.right
  const ch = H - pad.top - pad.bottom

  // 背景
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#f5fdff')
  bg.addColorStop(1, '#eefaff')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  if (pts.length < 1) {
    ctx.fillStyle = '#6d96a8'
    ctx.font = '14px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('暂无判级数据（请先连接水杯检测）', W / 2, H / 2)
    return
  }

  const tMin = pts[0].timestamp
  const tMax = pts[pts.length - 1].timestamp
  const tRange = Math.max(tMax - tMin, 60_000)

  function xOf(t: number) { return pad.left + ((t - tMin) / tRange) * cw }
  function yOf(gi: number) { return pad.top + (gi / 5) * ch }

  // 网格线 + Y 轴标签（GB 等级名）
  ctx.strokeStyle = 'rgba(72, 148, 180, .18)'
  ctx.lineWidth = 1
  ctx.font = '11px system-ui'
  ctx.textAlign = 'right'
  for (let gi = 0; gi <= 5; gi++) {
    const y = yOf(gi)
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(W - pad.right, y)
    ctx.stroke()
    ctx.fillStyle = gradeColor(gi)
    ctx.fillText(`${GB_GRADE_ORDER[gi]}`, pad.left - 8, y + 4)
  }

  // X 轴标签（首尾时间）
  ctx.fillStyle = '#6d96a8'
  ctx.textAlign = 'center'
  ctx.fillText(fmtTime(tMin), pad.left, H - 10)
  ctx.fillText(fmtTime(tMax), W - pad.right, H - 10)

  // 绘制折线：逐段判断 gap
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const isGap = (b.timestamp - a.timestamp) > GAP_THRESHOLD_MS

    ctx.beginPath()
    ctx.moveTo(xOf(a.timestamp), yOf(a.grade_index))
    if (isGap) {
      ctx.setLineDash([5, 6])
      ctx.strokeStyle = 'rgba(123, 158, 174, .55)'
    } else {
      ctx.setLineDash([])
      ctx.strokeStyle = gradeColor(a.grade_index)
    }
    ctx.lineWidth = 2.4
    ctx.lineTo(xOf(b.timestamp), yOf(b.grade_index))
    ctx.stroke()
  }
  ctx.setLineDash([])

  // 数据点
  for (const p of pts) {
    ctx.beginPath()
    ctx.arc(xOf(p.timestamp), yOf(p.grade_index), 4.2, 0, Math.PI * 2)
    ctx.fillStyle = gradeColor(p.grade_index)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  }

  // 图例
  ctx.font = '11px system-ui'
  let lx = pad.left
  for (let gi = 0; gi <= 5; gi++) {
    ctx.fillStyle = gradeColor(gi)
    ctx.fillRect(lx, 10, 10, 10)
    ctx.fillStyle = '#4e839a'
    ctx.textAlign = 'start'
    ctx.fillText(GB_GRADE_ORDER[gi], lx + 14, 19)
    lx += 55
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

watch(ratingTimeline, () => nextTick(drawChart), { deep: true })

onMounted(() => {
  loadReports()
  nextTick(drawChart)
  updateActiveSection()
  window.addEventListener('resize', drawChart)
  window.addEventListener('scroll', updateActiveSection, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('resize', drawChart)
  window.removeEventListener('scroll', updateActiveSection)
})
</script>


<template>
  <div class="dashboard-shell">
    <!-- ═══════════ 左侧悬浮导航 ═══════════ -->
    <aside class="sidebar-panel">
      <div class="brand-block">
        <span class="brand-logo" aria-hidden="true">
          <svg viewBox="0 0 36 36" width="34" height="34">
            <defs>
              <linearGradient id="logoWater" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#7ee4ff" />
                <stop offset="1" stop-color="#168bd2" />
              </linearGradient>
            </defs>
            <path d="M18 3C18 3 7 16 7 23a11 11 0 0022 0C29 16 18 3 18 3z" fill="url(#logoWater)" />
            <path d="M13 23c3 2.2 7 2.2 10 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".9" />
            <circle cx="22" cy="13" r="2.1" fill="#eaffff" opacity=".95" />
          </svg>
        </span>
        <div>
          <strong>{{ config.public.appName }}</strong>
          <em>·水质检测</em>
        </div>
      </div>

      <!-- BLE 连接：紧挨标题下方 -->
      <div class="side-ble">
        <template v-if="!demoOn">
          <button v-if="!ble.connected.value" class="btn-ble" @click="ble.connect">
            {{ ble.supported.value ? '🔗 连接水杯 BLE' : 'BLE 不可用' }}
          </button>
          <button v-else class="btn-ble connected" @click="ble.disconnect">
            断开 · {{ ble.deviceName.value }}
          </button>
        </template>
        <p v-else class="ble-demo-note">Demo 模式已开启，无需连接硬件</p>
      </div>

      <nav class="quick-menu" aria-label="快捷功能菜单">
        <a
          v-for="item in navItems"
          :key="item.id"
          class="quick-item"
          :class="{ active: activeSection === item.id }"
          @click="scrollToSection(item.id)"
        >
          <span>{{ item.icon }}</span><b>{{ item.label }}</b>
        </a>
      </nav>

      <div class="side-control">
        <label class="demo-switch">
          <input type="checkbox" v-model="demoOn" />
          <span>Demo 模式（无硬件模拟）</span>
        </label>
        <label v-if="demoOn" class="demo-switch sub">
          <input type="checkbox" v-model="demoStable" />
          <span>稳定数据（可测采集稳定态）</span>
        </label>
      </div>
    </aside>

    <!-- ═══════════ 右侧主区 ═══════════ -->
    <main class="main-area">
      <header class="topbar">
        <div>
          <p class="eyebrow">Water Environment Intelligence</p>
          <h1>Dashboard</h1>
        </div>
        <div class="top-actions">
          <span v-if="ble.error.value" class="err">{{ ble.error.value }}</span>
          <span class="status-pill" :class="{ live: displayMetrics }">
            <i></i>{{ displayMetrics ? '数据接入中' : '未接入' }}
          </span>
        </div>
      </header>

      <!-- ─── Hero ─── -->
      <section id="hero" class="hero-card section-anchor">
        <div class="hero-copy">
          <span class="hero-tag">Smart Cup · GB 3838 云评级</span>
          <h2>饮水安全，一杯即测</h2>
          <p>智能水杯实时采集，云端随机森林模型评估水质等级</p>
          <div class="wait-box">
            <span v-if="!displayMetrics" class="dot-pulse"></span>
            <span>{{ displayMetrics ? '数据已接入，检测中…' : '等待数据 · 连接水杯或开启 Demo' }}</span>
          </div>
          <p v-if="!demoOn && ble.connected.value" class="wet-tip">
            {{ displayMetrics?.wet ? '✅ 水杯已浸没' : '⚠️ 水杯未浸入水中，请浸没后检测' }}
          </p>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <svg viewBox="0 0 170 150" width="185" height="165">
            <defs>
              <linearGradient id="cupGlass" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="rgba(255,255,255,.92)" />
                <stop offset="1" stop-color="rgba(210,244,255,.42)" />
              </linearGradient>
              <linearGradient id="cupWater" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#80e8ff" />
                <stop offset="1" stop-color="#178bd4" />
              </linearGradient>
            </defs>
            <circle cx="126" cy="34" r="18" fill="rgba(255,255,255,.28)" />
            <circle cx="42" cy="38" r="10" fill="rgba(220,255,255,.45)" />
            <path d="M52 34h66l-7 92a18 18 0 01-18 16H77a18 18 0 01-18-16z" fill="url(#cupGlass)" stroke="#fff" stroke-width="4" />
            <path d="M61 86c14-10 28 8 43-1 5-3 9-5 12-5l-4 46a18 18 0 01-18 16H77a18 18 0 01-18-16z" fill="url(#cupWater)" opacity=".86" />
            <path d="M65 75c12-7 24 6 37 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".9" />
            <path d="M121 67c9 0 16 7 16 16s-7 16-16 16" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="8" stroke-linecap="round" />
            <path d="M85 12s-12 14-12 22a12 12 0 0024 0c0-8-12-22-12-22z" fill="#dfffff" opacity=".95" />
          </svg>
        </div>
      </section>

      <!-- ─── 主卡片区：水质评价 + 传感器数据 + 采集/提交 ─── -->
      <section class="card-grid primary-grid">
        <!-- 水质评价：独立卡片，位于传感器数据上方/之前 -->
        <article id="evaluation" class="float-card eval-card section-anchor">
          <div class="card-title">
            <span class="icon-bubble">🧪</span>
            <div>
              <h3>水质评价</h3>
              <small>GB 3838-2002 六等级云端判级</small>
            </div>
          </div>

          <div
            v-if="displayGrade"
            class="eval"
            :style="{
              background: GRADE_COLORS[displayGradeIndex ?? 3]?.bg ?? '#f5f5f5',
              borderLeft: `4px solid ${GRADE_COLORS[displayGradeIndex ?? 3]?.text ?? '#999'}`,
            }"
          >
            <p class="grade-text" :style="{ color: GRADE_COLORS[displayGradeIndex ?? 3]?.text }">
              <b>{{ displayGrade }} · {{ GB_GRADE_TAGLINES[displayGrade] }}</b>
            </p>
            <p class="grade-desc">{{ GB_GRADE_LABELS[displayGrade] }}</p>
            <p v-if="displayConfidence != null" class="confidence">
              模型置信度：<b>{{ (displayConfidence * 100).toFixed(2) }}%</b>
            </p>
            <small>（每 3 帧/模拟批次评测一次，统一调用后端随机森林模型 · 仅供参考）</small>
          </div>
          <div v-else class="empty-state">
            <b>等待评级结果</b>
            <span>连接水杯或开启 Demo 后，系统会自动调用模型进行实时判级。</span>
          </div>
        </article>

        <!-- 实时水质检测数据：默认折叠 -->
        <article id="sensor-data" class="float-card data-card section-anchor">
          <div class="card-title split-title">
            <span class="icon-bubble">
              <svg viewBox="0 0 30 30" width="22" height="22" aria-hidden="true">
                <path d="M15 3s-9 10-9 17a9 9 0 0018 0C24 13 15 3 15 3z" fill="#168bd4" />
                <path d="M10 20c3 2 7 2 10 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" />
              </svg>
            </span>
            <div class="title-copy">
              <h3>实时水质检测数据</h3>
              <small>智能水杯传感器指标</small>
            </div>
            <button class="collapse-toggle" type="button" @click="sensorExpanded = !sensorExpanded">
              {{ sensorExpanded ? '收起指标' : '展开指标' }}
              <span :class="{ open: sensorExpanded }">⌄</span>
            </button>
          </div>

          <div v-show="sensorExpanded" class="metric-collapse">
            <MetricCard :metrics="displayMetrics" />
          </div>
          <p v-show="!sensorExpanded" class="collapse-hint">
            {{ displayMetrics ? '传感器数据已接入，点击展开查看 pH / EC / TDS / 浊度等原始指标。' : '暂无传感器数据，连接设备或开启 Demo 后可查看。' }}
          </p>
        </article>

        <!-- 采集 / 提交报告 -->
        <article id="capture-report" class="float-card feedback-card capture-card section-anchor">
          <div class="card-title">
            <span class="icon-bubble">📝</span>
            <div>
              <h3>提交检测报告</h3>
              <small>采集稳定样本 · 记录水体信息</small>
            </div>
          </div>

          <!-- 阶段 0：idle -->
          <template v-if="capture.status.value === 'idle'">
            <p class="hint">
              点击「开始记录」后将连续检测水质，待读数基本稳定并去除离散数据后，
              自动收集 {{ capture.target }} 条有效样本。
            </p>
            <button class="primary" :disabled="!displayMetrics" @click="onStartCapture">
              {{ displayMetrics ? '开始记录 ▶' : '等待水质数据…' }}
            </button>
          </template>

          <!-- 阶段 1：collecting -->
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
              <label
                v-for="wt in WATER_TYPE_ORDER"
                :key="wt"
                class="wt-opt"
                :class="{ checked: waterType === wt }"
              >
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

            <label class="confirm" :class="{ checked: authenticityConfirmed }">
              <input type="checkbox" v-model="authenticityConfirmed" />
              <span>我确认本次上传的是<b>真实采集的水体数据</b>，未经伪造。</span>
            </label>

            <button class="primary" :disabled="!canSubmit" @click="onSubmit">
              {{ submitting ? '提交中…' : '提交报告（入库 ⬆）' }}
            </button>
            <button class="ghost" :disabled="submitting" @click="capture.cancel">放弃本次采集</button>
          </template>

          <!-- 提交结果 -->
          <div
            v-if="reportResult"
            class="result"
            :style="{
              background: GRADE_COLORS[reportResult.grade_index]?.bg ?? '#f5f5f5',
              borderLeft: `4px solid ${GRADE_COLORS[reportResult.grade_index]?.text ?? '#999'}`,
            }"
          >
            <b>✅ 报告已提交</b>
            <p>ID：<b>{{ reportResult.report_id }}</b></p>
            <p>等级：<b>{{ reportResult.grade }}</b> · {{ GB_GRADE_LABELS[reportResult.grade] }}</p>
            <details v-if="reportResult.llm_report">
              <summary>LLM 分析报告</summary>
              <div class="llm" v-html="reportResult.llm_report" />
            </details>
          </div>
        </article>
      </section>

      <!-- ─── 次卡片区：真实 Canvas 波形图 + 历史入口 ─── -->
      <section class="card-grid secondary-grid">
        <article id="trend-chart" class="white-card chart-card section-anchor">
          <div class="card-title compact">
            <span class="icon-bubble pale">📈</span>
            <div>
              <h3>判级趋势波形图</h3>
              <small>每 3 帧一次 · GB 3838 等级时间序列</small>
            </div>
          </div>
          <div class="canvas-wrap">
            <canvas ref="canvasRef" />
          </div>
          <p class="chart-hint">虚线间隙 = 超过 30 秒无数据（未连接或未评测）</p>
        </article>

        <article class="white-card history-card">
          <div class="card-title compact">
            <span class="icon-bubble pale">🕘</span>
            <div>
              <h3>历史水质检测记录列表</h3>
              <small>过往检测数据归档</small>
            </div>
          </div>
          <div class="history-list">
            <div class="history-row">
              <span class="level-dot safe"></span>
              <div><b>最近检测</b><small>{{ displayMetrics ? '当前设备数据已接入' : '等待首次检测数据' }}</small></div>
            </div>
            <div class="history-row muted">
              <span class="level-dot"></span>
              <div><b>完整记录</b><small>查看每一次水质检测报告与分析结果</small></div>
            </div>
          </div>
          <button class="history-link" type="button" @click="scrollToSection('reports')">查看历史记录 →</button>
        </article>
      </section>

      <!-- ─── 已提交报告表格：由 history.vue 迁移至首页 ─── -->
      <section id="reports" class="white-card reports-card section-anchor">
        <div class="card-title compact">
          <span class="icon-bubble pale">📋</span>
          <div>
            <h3>已提交报告</h3>
            <small>后端入库记录 · 最近 20 条</small>
          </div>
        </div>

        <p v-if="loading" class="table-state">加载中…</p>
        <p v-else-if="reportError" class="err">{{ reportError }}</p>
        <template v-else>
          <div v-if="reports.length" class="reports-table-wrap">
            <table class="reports-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>地点</th>
                  <th>等级</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in reports"
                  :key="r.report_id"
                  :style="{ borderLeft: `4px solid ${gradeColor(r.grade_index)}` }"
                >
                  <td>{{ new Date(r.measured_at).toLocaleString() }}</td>
                  <td>{{ r.location?.region ?? '-' }}</td>
                  <td :style="{ color: gradeColor(r.grade_index), fontWeight: 900 }">
                    {{ r.grade }}
                  </td>
                  <td class="note-cell">{{ r.user_note || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="table-state">暂无提交记录</p>
        </template>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* 水环境科技风：左侧悬浮导航 + 右侧分层浮空卡片 */
.dashboard-shell {
  position: relative;
  display: grid;
  grid-template-columns: 286px minmax(0, 1fr);
  gap: 28px;
  max-width: 1480px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 28px;
  color: #103c58;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.dashboard-shell::before,
.dashboard-shell::after {
  content: '';
  position: fixed;
  pointer-events: none;
  z-index: -1;
}
.dashboard-shell::before {
  inset: 0;
  background:
    radial-gradient(circle at 17% 18%, rgba(49, 191, 224, .32), transparent 28%),
    radial-gradient(circle at 78% 12%, rgba(105, 229, 241, .34), transparent 26%),
    radial-gradient(circle at 84% 78%, rgba(57, 145, 218, .26), transparent 30%),
    linear-gradient(135deg, rgba(184, 235, 254, .9), rgba(118, 208, 242, .7) 44%, rgba(194, 241, 255, .84));
}
.dashboard-shell::after {
  inset: 0;
  opacity: .78;
  background-image:
    radial-gradient(circle, rgba(255,255,255,.72) 0 2px, transparent 2.4px),
    repeating-radial-gradient(ellipse at 22% 34%, rgba(255,255,255,.22) 0 2px, rgba(31,151,208,.18) 3px, transparent 7px, transparent 34px),
    linear-gradient(118deg, transparent 0 24%, rgba(255,255,255,.18) 25%, transparent 38% 100%);
  background-size: 130px 130px, 620px 360px, 100% 100%;
}

/* ── 侧栏 ── */
.sidebar-panel {
  position: sticky;
  top: 28px;
  align-self: start;
  min-height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 20px;
  border: 1px solid rgba(255,255,255,.68);
  border-radius: 34px;
  background: linear-gradient(150deg, rgba(255,255,255,.82), rgba(224,248,255,.7) 54%, rgba(198,236,250,.74));
  box-shadow: 0 28px 70px rgba(20, 105, 154, .28), inset 0 1px 0 rgba(255,255,255,.9);
  backdrop-filter: blur(18px);
}
.brand-block { display: flex; align-items: center; gap: 12px; padding: 8px 8px 16px; }
.brand-logo {
  width: 48px; height: 48px;
  display: grid; place-items: center;
  border-radius: 18px;
  background: linear-gradient(135deg, #dfffff, #77d9ff);
  box-shadow: 0 14px 24px rgba(21, 139, 212, .3);
}
.brand-block strong { display: block; font-size: 20px; line-height: 1; color: #126293; letter-spacing: .2px; }
.brand-block em { display: block; margin-top: 4px; font-style: normal; font-size: 13px; font-weight: 700; color: #5a9fbf; }

.quick-menu { display: grid; gap: 13px; }
.quick-item {
  display: flex; align-items: center; gap: 12px;
  min-height: 54px; padding: 10px 14px;
  border-radius: 22px;
  color: #2b657f; text-decoration: none;
  background: linear-gradient(145deg, rgba(255,255,255,.88), rgba(220,247,255,.68));
  box-shadow: 0 14px 26px rgba(28, 127, 180, .14), inset 0 1px 0 rgba(255,255,255,.82);
  cursor: pointer;
  transition: transform .16s ease, box-shadow .16s ease, color .16s ease;
}
.quick-item span {
  width: 34px; height: 34px;
  display: grid; place-items: center;
  border-radius: 14px;
  background: rgba(255,255,255,.78);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.85);
}
.quick-item b { font-size: 14px; }
.quick-item:hover { transform: translateY(-3px); box-shadow: 0 18px 34px rgba(28,127,180,.2); }
.quick-item.active {
  color: #fff;
  background: linear-gradient(135deg, #27bee2, #167ed3 58%, #23c4c1);
  box-shadow: 0 18px 34px rgba(21, 139, 212, .34);
}

.side-control { margin-top: auto; display: grid; gap: 12px; }
.demo-switch { display: flex; align-items: center; gap: 8px; color: #35677e; font-size: 14px; font-weight: 700; cursor: pointer; }
.demo-switch.sub { font-size: 13px; font-weight: 600; color: #5a8095; }
.btn-ble {
  border: none; border-radius: 18px;
  padding: 12px 16px; color: #fff; font-weight: 800; cursor: pointer;
  background: linear-gradient(135deg, #20c5c2, #168bd4);
  box-shadow: 0 14px 28px rgba(20, 139, 212, .32);
  transition: transform .16s ease, box-shadow .16s ease;
}
.btn-ble:hover { transform: translateY(-2px); box-shadow: 0 18px 32px rgba(20,139,212,.4); }
.btn-ble.connected { background: linear-gradient(135deg, #168bd4, #0c6aa6); }
.side-ble {
  display: grid;
  gap: 10px;
  padding: 0 6px 2px;
}
.side-ble .btn-ble {
  width: 100%;
}
.ble-demo-note {
  margin: 0;
  padding: 12px 14px;
  border-radius: 18px;
  color: #24718f;
  font-size: 13px;
  font-weight: 800;
  background: linear-gradient(145deg, rgba(255,255,255,.82), rgba(221,250,255,.68));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.88), 0 10px 20px rgba(28,127,180,.12);
}

/* ── 主区 ── */
.main-area { min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 2px 4px; }
.eyebrow { margin: 0 0 3px; color: #2f83a5; font-size: 12px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
.topbar h1 { margin: 0; color: #105179; font-size: clamp(32px, 3vw, 48px); line-height: 1; letter-spacing: -.04em; }
.top-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.err { color: #e2603b; font-size: 13px; font-weight: 700; }
.status-pill,
.ghost-btn {
  display: inline-flex; align-items: center; gap: 8px;
  min-height: 40px; padding: 0 16px;
  border-radius: 999px;
  background: rgba(255,255,255,.78);
  color: #315f75; font-size: 13px; font-weight: 800; text-decoration: none;
  box-shadow: 0 12px 25px rgba(24,118,170,.14);
}
.status-pill i { width: 9px; height: 9px; border-radius: 50%; background: #aac6d4; }
.status-pill.live i { background: #20c5c2; box-shadow: 0 0 0 6px rgba(32,197,194,.18); }

.hero-card,
.float-card,
.white-card {
  position: relative; overflow: hidden;
  border: 1px solid rgba(255,255,255,.65);
  box-shadow: 0 26px 62px rgba(20, 102, 151, .25), inset 0 1px 0 rgba(255,255,255,.55);
  backdrop-filter: blur(12px);
}
.hero-card {
  display: flex; justify-content: space-between; align-items: center; gap: 24px;
  min-height: 210px; padding: 34px 42px;
  border-radius: 38px; color: #fff;
  background:
    radial-gradient(circle at 84% 18%, rgba(255,255,255,.35), transparent 26%),
    radial-gradient(circle at 18% 82%, rgba(115,236,255,.24), transparent 30%),
    linear-gradient(125deg, #168bd4 0%, #27bde2 46%, #23c4c1 100%);
}
.hero-card::before {
  content: '';
  position: absolute; inset: auto -10% -30% 22%; height: 120px;
  background: repeating-radial-gradient(ellipse at center, rgba(255,255,255,.34) 0 2px, transparent 4px 20px);
  opacity: .42;
}
.hero-copy { position: relative; z-index: 1; }
.hero-tag { display: inline-flex; margin-bottom: 12px; padding: 7px 14px; border-radius: 999px; background: rgba(255,255,255,.18); font-size: 12px; font-weight: 900; letter-spacing: .08em; }
.hero-copy h2 { margin: 0 0 8px; font-size: clamp(28px, 3vw, 44px); line-height: 1.05; letter-spacing: -.04em; }
.hero-copy > p { margin: 0 0 20px; font-size: 16px; opacity: .93; }
.wait-box { display: inline-flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 18px; border: 1px dashed rgba(255,255,255,.62); background: rgba(255,255,255,.17); font-size: 14px; font-weight: 800; }
.dot-pulse { width: 10px; height: 10px; border-radius: 50%; background: #fff39a; box-shadow: 0 0 0 0 rgba(255,243,154,.75); animation: pulse 1.5s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,243,154,.75); } 70% { box-shadow: 0 0 0 12px rgba(255,243,154,0); } 100% { box-shadow: 0 0 0 0 rgba(255,243,154,0); } }
.wet-tip { margin: 14px 0 0; font-weight: 800; }
.hero-visual { position: relative; z-index: 1; flex: 0 0 auto; filter: drop-shadow(0 24px 30px rgba(0,76,124,.25)); }

.card-grid { display: grid; gap: 24px; }
.primary-grid,
.secondary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.capture-card,
.reports-card { grid-column: 1 / -1; }
.section-anchor { scroll-margin-top: 28px; }
.float-card,
.white-card { border-radius: 34px; padding: 26px; }
.data-card { background: linear-gradient(145deg, rgba(229,248,255,.92), rgba(174,225,250,.86) 48%, rgba(129,205,242,.82)); }
.eval-card { background: linear-gradient(145deg, rgba(255,252,232,.96), rgba(226,249,255,.88) 48%, rgba(184,238,255,.84)); }
.feedback-card { background: linear-gradient(145deg, rgba(226,253,249,.94), rgba(184,241,236,.88) 48%, rgba(154,230,235,.82)); }
.white-card { background: linear-gradient(145deg, rgba(255,255,255,.92), rgba(239,252,255,.84)); }
.card-title { display: flex; align-items: center; gap: 13px; margin-bottom: 18px; }
.card-title.compact { margin-bottom: 12px; }
.card-title h3 { margin: 0; color: #105179; font-size: 19px; font-weight: 900; letter-spacing: -.02em; }
.card-title small { margin-top: 3px; color: #4e839a; }
.icon-bubble { width: 46px; height: 46px; flex: 0 0 46px; display: grid; place-items: center; border-radius: 18px; background: rgba(255,255,255,.72); box-shadow: 0 12px 24px rgba(28,127,180,.16); font-size: 21px; }
.icon-bubble.pale { background: linear-gradient(135deg, #e9fbff, #ffffff); }

/* ── 实时评级卡 ── */
.eval { padding: 14px 16px; border-radius: 18px; margin-top: 16px; }
.grade-text { font-size: 30px; margin: 2px 0 4px; letter-spacing: -.02em; }
.grade-desc { font-size: 14px; color: #345; margin: 4px 0; }
.confidence { font-size: 13px; color: #557; margin: 4px 0; }
small { display: block; color: #5f8798; margin-top: 4px; }

/* ── 采集流程 ── */
.hint { font-size: 13px; color: #35677e; margin: 4px 0 12px; line-height: 1.6; }
.cap-stage { font-size: 14px; font-weight: 700; color: #17435e; margin: 4px 0 10px; }
.cap-meta { font-size: 13px; color: #4e839a; margin: 10px 0; }
.cap-bar { height: 12px; border-radius: 6px; background: rgba(255,255,255,.6); overflow: hidden; box-shadow: inset 0 1px 3px rgba(20,105,154,.16); }
.cap-bar-fill { height: 100%; background: linear-gradient(90deg, #23c4c1, #168bd4); transition: width .3s ease; }

.field-label { display: block; font-size: 13px; font-weight: 800; color: #2b657f; margin: 16px 0 8px; }
.water-types { display: flex; flex-wrap: wrap; gap: 10px; }
.wt-opt {
  font-size: 14px; display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 999px; cursor: pointer;
  background: rgba(255,255,255,.72); color: #2b657f; font-weight: 700;
  border: 1.5px solid transparent;
  box-shadow: 0 8px 18px rgba(28,127,180,.1);
  transition: transform .14s ease, border-color .14s ease, background .14s ease;
}
.wt-opt:hover { transform: translateY(-2px); }
.wt-opt.checked { border-color: #1aa4d8; background: rgba(207,244,255,.92); color: #105179; }
.wt-opt input { accent-color: #168bd4; }

.note-input {
  width: 100%; box-sizing: border-box; min-height: 76px;
  padding: 13px 15px;
  border: 1.5px solid rgba(38, 161, 203, .24);
  border-radius: 18px; outline: none; resize: vertical;
  background: rgba(255,255,255,.78); color: #123d58; font: inherit;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
}
.note-input:focus { border-color: #1aa4d8; box-shadow: 0 0 0 5px rgba(26,164,216,.12); }

.confirm {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 14px; margin: 16px 0; padding: 12px 14px;
  border-radius: 16px; cursor: pointer;
  background: rgba(255,255,255,.6); border: 1.5px solid transparent;
  transition: border-color .14s ease, background .14s ease;
}
.confirm.checked { border-color: #23c4c1; background: rgba(226,253,249,.85); }
.confirm input { margin-top: 2px; accent-color: #168bd4; }

.primary {
  width: 100%; margin-top: 14px; border: none; border-radius: 20px;
  padding: 14px 20px; color: #fff; font-weight: 900; font-size: 15px; cursor: pointer;
  background: linear-gradient(135deg, #23c4c1, #168bd4);
  box-shadow: 0 16px 30px rgba(20,139,212,.3);
  transition: transform .16s ease, box-shadow .16s ease;
}
.primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 20px 36px rgba(20,139,212,.38); }
.primary:disabled { background: #a8d0df; cursor: not-allowed; box-shadow: none; }
.ghost {
  width: 100%; margin-top: 10px; padding: 11px 18px;
  border: 1.5px solid rgba(46,134,222,.35); border-radius: 20px;
  background: rgba(255,255,255,.5); color: #2b657f; font-weight: 800; cursor: pointer;
  transition: background .14s ease;
}
.ghost:hover:not(:disabled) { background: rgba(255,255,255,.85); }
.ghost:disabled { opacity: .5; cursor: not-allowed; }

/* ── 提交结果 ── */
.result { margin-top: 16px; padding: 15px 16px; border-radius: 18px; background: rgba(255,255,255,.7); }
.result p { margin: 5px 0; }
.llm { white-space: pre-wrap; font-size: 14px; margin-top: 8px; }
details summary { cursor: pointer; color: #105179; margin-top: 8px; font-weight: 800; }

/* ── 波形 / 历史 ── */
.split-title { align-items: flex-start; }
.title-copy { min-width: 0; flex: 1; }
.collapse-toggle {
  margin-left: auto;
  border: none;
  border-radius: 999px;
  padding: 9px 13px;
  color: #17658b;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  background: rgba(255,255,255,.74);
  box-shadow: 0 10px 20px rgba(28,127,180,.14), inset 0 1px 0 rgba(255,255,255,.85);
  transition: transform .16s ease, background .16s ease;
}
.collapse-toggle:hover { transform: translateY(-2px); background: rgba(255,255,255,.95); }
.collapse-toggle span { display: inline-block; margin-left: 5px; transition: transform .16s ease; }
.collapse-toggle span.open { transform: rotate(180deg); }
.metric-collapse { margin-top: 8px; }
.collapse-hint,
.empty-state,
.table-state {
  margin: 0;
  padding: 16px 18px;
  border-radius: 20px;
  color: #416f84;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.6;
  background: rgba(255,255,255,.52);
  border: 1px dashed rgba(37, 151, 196, .28);
}
.empty-state { display: grid; gap: 4px; }
.empty-state b { color: #105179; font-size: 18px; }
.empty-state span { color: #5f8798; }
.canvas-wrap {
  width: 100%;
  height: 300px;
  margin-top: 8px;
  border: 1px solid rgba(38, 161, 203, .18);
  border-radius: 24px;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(245,253,255,.9), rgba(231,249,255,.72));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 14px 30px rgba(28,127,180,.12);
}
.canvas-wrap canvas { width: 100%; height: 100%; display: block; }
.chart-hint { margin: 8px 0 0; color: #6a92a4; font-size: 12px; font-weight: 700; }
.history-list { display: grid; gap: 12px; margin: 14px 0 18px; }
.history-row { display: flex; align-items: center; gap: 12px; padding: 13px 14px; border-radius: 20px; background: rgba(233,250,255,.72); }
.history-row b { display: block; color: #164f70; }
.history-row.muted { opacity: .82; }
.level-dot { width: 12px; height: 12px; border-radius: 50%; background: #8bbdd1; box-shadow: 0 0 0 6px rgba(139,189,209,.14); }
.level-dot.safe { background: #23c4c1; box-shadow: 0 0 0 6px rgba(35,196,193,.16); }
.history-link {
  border: none;
  display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 19px; border-radius: 999px; color: #fff; font-weight: 900; text-decoration: none; cursor: pointer; background: linear-gradient(135deg, #27bee2, #168bd4); box-shadow: 0 14px 28px rgba(20,139,212,.28); transition: transform .16s ease;
}
.history-link:hover { transform: translateY(-2px); }
.reports-card { overflow-x: hidden; }
.reports-table-wrap {
  width: 100%;
  overflow-x: auto;
  border-radius: 22px;
  border: 1px solid rgba(38, 161, 203, .16);
  background: rgba(255,255,255,.58);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.85);
}
.reports-table {
  width: 100%;
  min-width: 720px;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 14px;
}
.reports-table th,
.reports-table td {
  padding: 13px 15px;
  text-align: left;
  border-bottom: 1px solid rgba(38, 161, 203, .12);
}
.reports-table th {
  color: #2b657f;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: .08em;
  text-transform: uppercase;
  background: rgba(226,249,255,.72);
}
.reports-table tbody tr {
  background: rgba(255,255,255,.38);
  transition: background .14s ease, transform .14s ease;
}
.reports-table tbody tr:hover { background: rgba(232,250,255,.82); }
.reports-table tbody tr:last-child td { border-bottom: none; }
.note-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 1040px) {
  .dashboard-shell { grid-template-columns: 1fr; padding: 20px; }
  .sidebar-panel { position: relative; top: auto; min-height: auto; }
  .quick-menu { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .primary-grid,
  .secondary-grid { grid-template-columns: 1fr; }
  .hero-card,
  .topbar { flex-direction: column; align-items: flex-start; }
  .hero-visual { align-self: center; }
}
</style>
