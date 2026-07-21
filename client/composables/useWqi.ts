import { ref } from 'vue'
import type { Metrics } from '~/types/reading'

/**
 * Demo Mode：无硬件时生成模拟指标。
 * 由 runtimeConfig.public.demoMode 或页面开关控制。
 *
 * ⚠️ Demo Mode 不调后端 /evaluate，用内置简化阈值直接显示 level，
 *    使其在不连 BLE 时也能看到完整 UI 效果。
 */
export function useDemo() {
  const running = ref(false)
  const metrics = ref<Metrics | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  function rand(min: number, max: number, d = 1) {
    return +(min + Math.random() * (max - min)).toFixed(d)
  }

  function tick(): Metrics {
    return {
      tds: rand(50, 600, 0),
      ph: rand(6.0, 8.5, 2),
      temperature: rand(15, 50, 1),
      turbidity: rand(0.2, 6, 2),
      ec: rand(100, 1200, 0),
      wet: Math.random() > 0.3, // 70% 概率模拟已浸没
    }
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
 * ─ 正常 BLE 模式下由后端数学模型判级，不走此函数
 */
export function demoLevelFallback(m: Metrics): { level: string; wqi: number } {
  const ph = (m.ph as number) ?? 7
  const tds = (m.tds as number) ?? 0
  const turb = (m.turbidity as number) ?? 0
  if (ph < 6 || ph > 9 || tds > 600 || turb > 5) return { level: 'danger', wqi: 35 }
  if (ph < 6.5 || ph > 8.5 || tds > 300 || turb > 1) return { level: 'warning', wqi: 65 }
  return { level: 'safe', wqi: 85 }
}
