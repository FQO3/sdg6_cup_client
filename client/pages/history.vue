<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useReports } from '~/composables/useReports'
import { ratingTimeline, type RatingPoint } from '~/composables/useRatingHistory'
import type { ReportRecord } from '~/types/reading'

const { list } = useReports()

// ───── 提交报告列表 ─────
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

onMounted(loadReports)

// ───── 判级时间折线图 (Canvas) ─────
const canvasRef = ref<HTMLCanvasElement | null>(null)
const GAP_THRESHOLD_MS = 30_000 // 超过 30s 无数据视为间隙（灰色）

function drawChart() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const pts = ratingTimeline.value
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth
  const H = canvas.clientHeight
  canvas.width = W * dpr
  canvas.height = H * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const pad = { top: 20, right: 16, bottom: 40, left: 40 }
  const cw = W - pad.left - pad.right
  const ch = H - pad.top - pad.bottom

  // 背景
  ctx.fillStyle = '#fafafa'
  ctx.fillRect(0, 0, W, H)

  if (pts.length < 2) {
    ctx.fillStyle = '#999'
    ctx.font = '14px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('暂无判级数据（请先连接水杯检测）', W / 2, H / 2)
    return
  }

  const tMin = pts[0].timestamp
  const tMax = pts[pts.length - 1].timestamp
  const tRange = Math.max(tMax - tMin, 60_000) // 至少 1min 范围

  function xOf(t: number) { return pad.left + ((t - tMin) / tRange) * cw }
  function yOf(w: number) { return pad.top + ch - (w / 100) * ch }

  // 网格线 + Y 轴标签
  ctx.strokeStyle = '#e0e0e0'
  ctx.lineWidth = 1
  ctx.font = '11px system-ui'
  ctx.fillStyle = '#888'
  ctx.textAlign = 'right'
  for (let w = 0; w <= 100; w += 20) {
    const y = yOf(w)
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
    ctx.fillText(String(w), pad.left - 6, y + 4)
  }

  // X 轴标签（取首尾时间）
  ctx.textAlign = 'center'
  ctx.fillText(fmtTime(tMin), pad.left, H - 6)
  ctx.fillText(fmtTime(tMax), W - pad.right, H - 6)

  // 绘制折线：逐段判断 gap
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const isGap = (b.timestamp - a.timestamp) > GAP_THRESHOLD_MS

    ctx.beginPath()
    ctx.moveTo(xOf(a.timestamp), yOf(a.wqi))
    if (isGap) {
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#ccc'
    } else {
      ctx.setLineDash([])
      ctx.strokeStyle = levelColor(b.level)
    }
    ctx.lineWidth = 2
    ctx.lineTo(xOf(b.timestamp), yOf(b.wqi))
    ctx.stroke()
  }
  ctx.setLineDash([])

  // 数据点
  for (const p of pts) {
    ctx.beginPath()
    ctx.arc(xOf(p.timestamp), yOf(p.wqi), 3, 0, Math.PI * 2)
    ctx.fillStyle = levelColor(p.level)
    ctx.fill()
  }

  // 图例
  ctx.font = '11px system-ui'
  const legend = [
    { label: '安全', color: '#66bb6a' },
    { label: '一般', color: '#ffb300' },
    { label: '危险', color: '#ef5350' },
    { label: '无数据', color: '#ccc' },
  ]
  let lx = pad.left
  for (const l of legend) {
    ctx.fillStyle = l.color
    ctx.fillRect(lx, 8, 10, 10)
    ctx.fillStyle = '#555'
    ctx.textAlign = 'start'
    ctx.fillText(l.label, lx + 14, 17)
    lx += 70
  }
}

function levelColor(l: string): string {
  return l === 'safe' ? '#66bb6a' : l === 'warning' ? '#ffb300' : '#ef5350'
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// 监听 timeline 变化重绘 + resize
watch(ratingTimeline, () => nextTick(drawChart), { deep: true })
onMounted(() => { nextTick(drawChart); window.addEventListener('resize', drawChart) })
onUnmounted(() => window.removeEventListener('resize', drawChart))
</script>

<template>
  <main class="wrap">
    <h1>历史记录</h1>

    <!-- ═══ 判级时间折线图 ═══ -->
    <section class="chart-section">
      <h2>判级趋势（每 3 帧一次 · 实时）</h2>
      <div class="canvas-wrap">
        <canvas ref="canvasRef" />
      </div>
      <p class="chart-hint">虚线间隙 = 超过 30 秒无数据（未连接或未评测）</p>
    </section>

    <!-- ═══ 提交报告列表 ═══ -->
    <section class="reports-section">
      <h2>已提交报告</h2>
      <p v-if="loading">加载中…</p>
      <p v-else-if="reportError" class="err">{{ reportError }}</p>
      <template v-else>
        <table v-if="reports.length">
          <thead>
            <tr>
              <th>时间</th>
              <th>地点</th>
              <th>WQI</th>
              <th>等级</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in reports" :key="r.report_id" :class="r.level">
              <td>{{ new Date(r.measured_at).toLocaleString() }}</td>
              <td>{{ r.location?.region ?? '-' }}</td>
              <td>{{ r.wqi }}</td>
              <td>{{ r.level }}</td>
              <td class="note-cell">{{ r.user_note || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>暂无提交记录</p>
      </template>
    </section>

    <NuxtLink to="/">← 返回检测</NuxtLink>
  </main>
</template>

<style scoped>
.wrap { max-width: 800px; margin: 0 auto; padding: 24px; font-family: system-ui; }

/* ── 折线图 ── */
.chart-section { margin: 24px 0; }
.canvas-wrap { width: 100%; height: 280px; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #fafafa; }
.canvas-wrap canvas { width: 100%; height: 100%; }
.chart-hint { font-size: 12px; color: #999; margin-top: 6px; }

/* ── 报告列表 ── */
.reports-section { margin: 32px 0; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
th, td { border: 1px solid #e0e0e0; padding: 8px 10px; text-align: left; }
th { background: #f5f5f5; }
tr.safe td:last-child { border-left: 3px solid #66bb6a; }
tr.warning td:last-child { border-left: 3px solid #ffb300; }
tr.danger td:last-child { border-left: 3px solid #ef5350; }
.note-cell { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.err { color: #c0392b; }
</style>
