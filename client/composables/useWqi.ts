import { ref } from 'vue'
import type { Metrics } from '~/types/reading'

/**
 * Demo Mode：无硬件时模拟“传感器原始帧”。
 *
 * 重要：Demo 只负责生成与 ESP32/BLE 相同结构的 Metrics 数据，
 * 不做本地评级、不绕过后端模型、不绕过采集状态机。
 *
 * 链路保持与真实模式一致：
 *   模拟 raw frame → 3 帧中位数聚合 batchedMetrics → /api/evaluate → useCapture/useReports
 */

/** Demo 模式：'random'=全随机（跳跃）；'stable'=围绕基准小幅摆动，可进入稳定态 */
export type DemoMode = 'random' | 'stable'

/** 聚合窗口帧数：与 useBle 保持一致 */
const WINDOW_SIZE = 3
const NUMERIC_KEYS = ['temperature', 'ph', 'ec', 'turbidity'] as const
type NumericMetricKey = (typeof NUMERIC_KEYS)[number]

/** 稳定模式默认基准读数（可通过 setBase 覆盖）——一杯自来水量级 */
const DEFAULT_STABLE_BASE: Metrics = {
  temperature: 25,
  ph: 7.2,
  ec: 320,
  turbidity: 2.0,
  wet: true,
} as Metrics

/**
 * 稳定模式各特征的摆动幅度（在检测误差允许内的绝对波动）。
 * 幅度控制在 useCapture 判稳 CV 阈值之内（ph/temp 0.03、ec 0.08、turbidity 0.15），
 * 使连续读数能被判为“稳定”从而进入去离散 + 收样本流程。
 */
const STABLE_JITTER: Record<NumericMetricKey, number> = {
  temperature: 0.15, // ±0.15 ℃
  ph: 0.03,          // ±0.03
  ec: 4,             // ±4 μS/cm
  turbidity: 0.08,   // ±0.08 NTU
}

/** 与 BLE 侧一致：逐字段取 3 帧中位数，天然抗单点异常 */
function medianOfFrames(frames: Metrics[]): Metrics {
  const result: Metrics = {}
  for (const k of NUMERIC_KEYS) {
    const vals = frames
      .map((f) => f[k])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (!vals.length) continue
    const sorted = [...vals].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    result[k] = sorted[mid]
  }
  return result
}

export function useDemo() {
  const running = ref(false)
  /** 最新一帧模拟原始数据：等价于 BLE rawMetrics，用于 MetricCard 即时展示 */
  const metrics = ref<Metrics | null>(null)
  /** 每 3 帧中位数聚合结果：等价于 BLE batchedMetrics，用于触发 /api/evaluate 与 useCapture */
  const batchedMetrics = ref<Metrics | null>(null)
  const mode = ref<DemoMode>('random')
  const base = ref<Metrics>({ ...DEFAULT_STABLE_BASE })
  let timer: ReturnType<typeof setInterval> | null = null
  const frameBuf: Metrics[] = []

  function rand(min: number, max: number, d = 1) {
    return +(min + Math.random() * (max - min)).toFixed(d)
  }

  /** 在 [-a, +a] 内均匀摆动 */
  function jitter(center: number, a: number, d = 2) {
    return +(center + (Math.random() * 2 - 1) * a).toFixed(d)
  }

  /** 全随机读数：数据跳跃，通常不容易进入稳定采集 */
  function tickRandom(): Metrics {
    return {
      temperature: rand(10, 35, 1),   // ℃
      ph: rand(5.5, 9.5, 2),
      ec: rand(50, 1500, 0),          // μS/cm
      turbidity: rand(0.5, 50, 1),    // NTU
      /** 水位检测模拟：70% 概率浸没 */
      wet: Math.random() > 0.3,
    } as Metrics
  }

  /** 稳定读数：围绕 base 小幅摆动，可通过 useCapture 判稳 */
  function tickStable(): Metrics {
    const b = base.value
    return {
      temperature: jitter(b.temperature as number, STABLE_JITTER.temperature, 1),
      ph: jitter(b.ph as number, STABLE_JITTER.ph, 2),
      ec: Math.round(jitter(b.ec as number, STABLE_JITTER.ec, 0)),
      turbidity: Math.max(0, jitter(b.turbidity as number, STABLE_JITTER.turbidity, 2)),
      wet: true, // 稳定演示：持续浸没
    } as Metrics
  }

  function tick(): Metrics {
    return mode.value === 'stable' ? tickStable() : tickRandom()
  }

  function pushFrame(frame: Metrics) {
    metrics.value = frame
    frameBuf.push(frame)

    if (frameBuf.length >= WINDOW_SIZE) {
      const batch = frameBuf.slice(-WINDOW_SIZE)
      const agg = medianOfFrames(batch)
      // 与 BLE 侧保持一致：wet 透传最近一帧
      if (typeof frame.wet === 'boolean') agg.wet = frame.wet
      batchedMetrics.value = agg
      // 保留最后 1 帧，保持滑动窗口连续性
      frameBuf.splice(0, frameBuf.length - 1)
    }
  }

  function resetBatch() {
    frameBuf.length = 0
    batchedMetrics.value = null
  }

  /** 设置稳定模式基准读数（可只传部分字段，其余保留） */
  function setBase(partial: Partial<Metrics>) {
    base.value = { ...base.value, ...partial } as Metrics
  }

  /** 切换 Demo 模式（运行中切换即时生效，并清空旧模式的聚合缓冲） */
  function setMode(m: DemoMode) {
    mode.value = m
    resetBatch()
    if (running.value) pushFrame(tick())
  }

  function start() {
    // 定时器只在浏览器端运行，避免 SSR 期间调用 setInterval 报错
    if (import.meta.server) return
    running.value = true
    resetBatch()
    pushFrame(tick())
    timer = setInterval(() => pushFrame(tick()), 700)
  }


  function stop() {
    running.value = false
    if (timer) clearInterval(timer)
    timer = null
    frameBuf.length = 0
  }

  return { running, metrics, batchedMetrics, mode, base, setMode, setBase, start, stop }
}
