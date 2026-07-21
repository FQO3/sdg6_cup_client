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
export function useDemo() {
  const running = ref(false)
  const metrics = ref<Metrics | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  function rand(min: number, max: number, d = 1) {
    return +(min + Math.random() * (max - min)).toFixed(d)
  }

  /** 生成模拟传感器读数（4 参数：temperature, ph, ec, turbidity） */
  function tick(): Metrics {
    return {
      temperature: rand(10, 35, 1),   // ℃
      ph: rand(5.5, 9.5, 2),
      ec: rand(50, 1500, 0),          // μS/cm
      turbidity: rand(0.5, 50, 1),    // NTU
      /** 水位检测模拟：70% 概率浸没 */
      wet: Math.random() > 0.3,
    } as Metrics
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

  return { running, metrics, start, stop }
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
