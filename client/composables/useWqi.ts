import { ref } from 'vue'
import type { Metrics, WaterLevel } from '~/types/reading'

/**
 * Demo Mode：无硬件时生成模拟指标。
 * 由 runtimeConfig.public.demoMode 或页面开关控制。
 */
export function useDemo() {
  const running = ref(false)
  const metrics = ref<Metrics | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  function rand(min: number, max: number, d = 1) {
    /** 生成指定范围内的随机数，保留 d 位小数 **/
    return +(min + Math.random() * (max - min)).toFixed(d)
  }

  function tick(): Metrics {
    return {
      tds: rand(50, 600, 0),
      ph: rand(6.0, 8.5, 2),
      temperature: rand(15, 50, 1),
      turbidity: rand(0.2, 6, 2),
      ec: rand(100, 1200, 0),
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
 * 客户端仅做「离线降级判级」用于即时 UI 反馈；
 * 权威 WQI/level 以 POST /readings 后端同步返回为准。
 */
export function localLevelFallback(m: Metrics): WaterLevel {
  const ph = m.ph ?? 7
  const tds = m.tds ?? 0
  const turb = m.turbidity ?? 0
  if (ph < 6.5 || ph > 8.5 || tds > 500 || turb > 5) return 'danger'
  if (tds > 300 || turb > 1) return 'warning'
  return 'safe'
}
