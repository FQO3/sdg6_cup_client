import { ref } from 'vue'
import type { Metrics, GBGrade } from '~/types/reading'
import { GB_GRADE_ORDER } from '~/types/reading'

/**
 * Demo Mode：无硬件时生成模拟指标（4 参数：temperature, ph, ec, turbidity）。
 * 由 runtimeConfig.public.demoMode 或页面开关控制。
 *
 * ⚠️ Demo Mode 不调后端 /evaluate，用内置简化映射直接显示 GB 等级，
 *    使其在不连 BLE 时也能看到完整 UI 效果。
 */
/** Demo 模式：'random'=全随机（老行为）；'stable'=围绕基准小幅摆动，可进入稳定态 */
export type DemoMode = 'random' | 'stable'

/** 稳定模式默认基准读数（可通过 setBase 覆盖）——一杯自来水量级 */
const DEFAULT_STABLE_BASE: Metrics = {
  temperature: 25,
  ph: 7.2,
  ec: 320,
  turbidity: 2.0,
  wet: true,
} as Metrics

/**
 * 稳定模式各特征的**摆动幅度**（在检测误差允许内的绝对波动）。
 * 幅度控制在 useCapture 判稳 CV 阈值之内（ph/temp 0.03、ec 0.08、turbidity 0.15），
 * 使连续读数能被判为「稳定」从而进入去离散 + 收样本流程。
 */
const STABLE_JITTER: Record<'temperature' | 'ph' | 'ec' | 'turbidity', number> = {
  temperature: 0.15, // ±0.15 ℃
  ph: 0.03,          // ±0.03
  ec: 4,             // ±4 μS/cm
  turbidity: 0.08,   // ±0.08 NTU
}

export function useDemo() {
  const running = ref(false)
  const metrics = ref<Metrics | null>(null)
  const mode = ref<DemoMode>('random')
  const base = ref<Metrics>({ ...DEFAULT_STABLE_BASE })
  let timer: ReturnType<typeof setInterval> | null = null

  function rand(min: number, max: number, d = 1) {
    return +(min + Math.random() * (max - min)).toFixed(d)
  }

  /** 在 [-a, +a] 内均匀摆动 */
  function jitter(center: number, a: number, d = 2) {
    return +(center + (Math.random() * 2 - 1) * a).toFixed(d)
  }

  /** 全随机读数（老 Demo 行为，数据跳跃、无法稳定） */
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

  /** 设置稳定模式基准读数（可只传部分字段，其余保留） */
  function setBase(partial: Partial<Metrics>) {
    base.value = { ...base.value, ...partial } as Metrics
  }

  /** 切换 Demo 模式（运行中切换即时生效） */
  function setMode(m: DemoMode) {
    mode.value = m
    if (running.value) metrics.value = tick()
  }

  function start() {
    running.value = true
    metrics.value = tick()
    timer = setInterval(() => (metrics.value = tick()), 2000)
  }

  function stop() {
    running.value = false
    if (timer) clearInterval(timer)
    timer = null
  }

  return { running, metrics, mode, base, setMode, setBase, start, stop }
}

/**
 * Demo Mode 用的简化 fallback 判级（不调后端，仅演示 UI）
 * ─ 正常 BLE 模式下由 Water Quality Pipeline 随机森林判级，不走此函数。
 *
 * 模拟逻辑：用 ph 和 ec 的粗略范围估算 GB 等级（娱乐性质，非科学判级）
 */
export function demoLevelFallback(m: Metrics): {
  grade: GBGrade
  grade_index: number
  confidence: number
} {
  const ph = (m.ph as number) ?? 7
  const ec = (m.ec as number) ?? 300
  const turb = (m.turbidity as number) ?? 5

  // 粗略评分 heuristic（仅用于 Demo UI 动画效果）
  let score = 0
  if (ph >= 6.5 && ph <= 8.5) score += 2
  else if (ph >= 6 && ph <= 9) score += 1
  if (ec < 400) score += 2
  else if (ec < 800) score += 1
  if (turb < 5) score += 1
  if (turb < 15) score += 1

  // 映射到 GB 等级（越低越好 → 0 = Ⅰ类）
  const grade_index = Math.max(0, Math.min(5, 5 - score))
  return {
    grade: GB_GRADE_ORDER[grade_index],
    grade_index,
    confidence: 0.75 + Math.random() * 0.15,  // Demo 假置信度
  }
}
