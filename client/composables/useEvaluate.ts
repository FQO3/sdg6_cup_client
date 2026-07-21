import { ref, watch, type Ref } from 'vue'
import type { Metrics, EvaluateResult } from '~/types/reading'
import { appendRatingPoint } from '~/composables/useRatingHistory'

/**
 * 链路 A — 实时判级
 *
 * ─ 监听每 3 帧聚合后的 batchedMetrics → POST /evaluate → 覆盖显示 result
 * ─ 高频、不入库。result 仅用于当前 UI 覆盖。
 * ─ 采样点 push 到共享的 ratingTimeline（跨 index/history 页面）。
 */

export function useEvaluate(batchedMetrics: Ref<Metrics | null>) {
  const result = ref<EvaluateResult | null>(null)
  const loading = ref(false)

  watch(batchedMetrics, async (m) => {
    if (!m) return
    loading.value = true
    try {
      const res = await $fetch<{ code: number; data: EvaluateResult }>('/api/evaluate', {
        method: 'POST',
        body: { device_id: 'cup-001', metrics: m } as Record<string, unknown>,
      })
      if (res?.data) {
        result.value = res.data
        appendRatingPoint({
          timestamp: Date.now(),
          wqi: res.data.wqi,
          level: res.data.level,
        })
      }
    } catch {
      // 判级失败静默，保留上一次 result
    } finally {
      loading.value = false
    }
  })

  /** 重置（断开连接时调用） */
  function reset() {
    result.value = null
  }

  return { result, loading, reset }
}
