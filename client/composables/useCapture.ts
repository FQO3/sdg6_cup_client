import { ref, computed, watch, type Ref } from 'vue'
import type {
  Metrics,
  EvaluateResult,
  CaptureAggregate,
  GBGrade,
} from '~/types/reading'
import { GB_GRADE_ORDER } from '~/types/reading'

/**
 * 采集状态机 — "开始记录" → 连续检测 → 判稳 → 去离散 → 收满 20 条有效样本
 *
 * 流程：
 *   idle ──start()──▶ collecting
 *     每来一个新的聚合读数(batchedMetrics)记为一次"检测"：
 *       1) 压入最近 STABLE_WINDOW 帧的稳定窗口
 *       2) 窗口满后逐字段算变异系数 CV=σ/μ，全部 < 阈值 ⇒ 判为"基本稳定"
 *       3) 稳定后，用窗口均值±OUTLIER_K·σ 过滤：落区间内=有效样本，否则丢弃(离散)
 *       4) 有效样本累计到 TARGET_SAMPLES(20) ⇒ done
 *   收满后调用 /api/evaluate 对每条有效样本判级 → grade_index 取众数
 *
 * 说明：本地不判级，评级一律走后端 /evaluate（Demo Mode 也复用同一接口）。
 */

const TARGET_SAMPLES = 20          // 需收满的有效样本数
const STABLE_WINDOW = 5            // 稳定判定滑动窗口大小
const MAX_READINGS = 60            // 检测次数上限，防死循环
const OUTLIER_K = 2                // 去离散：均值 ± K·σ
const FEATURES = ['ph', 'temperature', 'ec', 'turbidity'] as const
type Feature = (typeof FEATURES)[number]
// 各特征稳定阈值（变异系数 σ/μ）
const CV_THRESHOLD: Record<Feature, number> = {
  ph: 0.03,
  temperature: 0.03,
  ec: 0.08,
  turbidity: 0.15,
}
// 去离散绝对下限：数据极干净时 σ 会非常小，须同时超过 K·σ 且超过传感器量化/抖动下限
// 才判为离散，否则正常量化跳动(±2~3)会被误杀
const OUTLIER_FLOOR: Record<Feature, number> = {
  ph: 0.15,
  temperature: 0.8,
  ec: 15,
  turbidity: 0.6,
}

export type CaptureStatus = 'idle' | 'collecting' | 'done' | 'error'

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
function std(xs: number[], mu = mean(xs)): number {
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)))
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
/** 取某特征的数值数组（忽略缺失） */
function feat(samples: Metrics[], f: Feature): number[] {
  return samples
    .map((s) => s[f])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

export function useCapture(
  batchedMetrics: Ref<Metrics | null>,
  deviceId: Ref<string>,
) {
  const status = ref<CaptureStatus>('idle')
  const errorMsg = ref('')

  // 采集过程状态
  const window = ref<Metrics[]>([])           // 稳定判定滑动窗口
  const validSamples = ref<Metrics[]>([])     // 已接受的有效样本
  const grades = ref<number[]>([])            // 每条有效样本的 grade_index
  const gradeLabels = ref<GBGrade[]>([])      // 每条有效样本的 grade
  const totalReadings = ref(0)                // 总检测次数
  const discarded = ref(0)                    // 被丢弃的离散帧数
  const stableReached = ref(false)            // 是否已达到"基本稳定"
  const lastCv = ref<Partial<Record<Feature, number>>>({})

  const aggregate = ref<CaptureAggregate | null>(null)

  const progress = computed(() => validSamples.value.length / TARGET_SAMPLES)
  const collected = computed(() => validSamples.value.length)
  const target = TARGET_SAMPLES

  function resetState() {
    window.value = []
    validSamples.value = []
    grades.value = []
    gradeLabels.value = []
    totalReadings.value = 0
    discarded.value = 0
    stableReached.value = false
    lastCv.value = {}
    aggregate.value = null
    errorMsg.value = ''
  }

  function start() {
    resetState()
    status.value = 'collecting'
  }

  function cancel() {
    status.value = 'idle'
    resetState()
  }

  /** 判定当前窗口是否"基本稳定"，并写入 lastCv */
  function checkStable(): boolean {
    if (window.value.length < STABLE_WINDOW) return false
    const cv: Partial<Record<Feature, number>> = {}
    for (const f of FEATURES) {
      const xs = feat(window.value, f)
      if (xs.length < STABLE_WINDOW) return false // 该特征数据不全，暂不判稳
      const mu = mean(xs)
      cv[f] = mu === 0 ? 0 : std(xs, mu) / Math.abs(mu)
    }
    lastCv.value = cv
    return FEATURES.every((f) => (cv[f] ?? Infinity) <= CV_THRESHOLD[f])
  }

  /** 去离散：样本每个特征是否落在窗口 均值±K·σ 内 */
  function isOutlier(m: Metrics): boolean {
    for (const f of FEATURES) {
      const v = m[f]
      if (typeof v !== 'number') continue
      const xs = feat(window.value, f)
      if (xs.length < STABLE_WINDOW) continue
      const mu = mean(xs)
      const sd = std(xs, mu)
      const dev = Math.abs(v - mu)
      if (sd > 0 && dev > OUTLIER_K * sd && dev > OUTLIER_FLOOR[f]) return true
    }
    return false
  }

  /** 对一条有效样本调后端判级 */
  async function gradeSample(m: Metrics): Promise<EvaluateResult | null> {
    try {
      const res = await $fetch<{ code: number; data: EvaluateResult }>('/api/evaluate', {
        method: 'POST',
        body: { device_id: deviceId.value, metrics: m },
      })
      return res?.data ?? null
    } catch {
      return null
    }
  }

  /** grade_index 取众数（并列时取更差=较大 index，偏保守） */
  function modeGrade(): { grade: GBGrade; grade_index: number; agreement: number } {
    const count = new Map<number, number>()
    for (const g of grades.value) count.set(g, (count.get(g) ?? 0) + 1)
    let best = grades.value[0] ?? 0
    let bestN = -1
    for (const [idx, n] of count) {
      if (n > bestN || (n === bestN && idx > best)) {
        best = idx
        bestN = n
      }
    }
    return {
      grade: GB_GRADE_ORDER[best],
      grade_index: best,
      agreement: grades.value.length ? bestN / grades.value.length : 0,
    }
  }

  /** 收满后构造聚合结果 */
  function finalize() {
    const samples = validSamples.value
    const repMetrics: Metrics = {}
    for (const f of FEATURES) {
      const xs = feat(samples, f)
      if (xs.length) repMetrics[f] = median(xs)
    }
    // tds 若存在也保留中位数（补充参考，不判级）
    const tds = feat(samples, 'tds' as Feature)
    if (tds.length) repMetrics.tds = median(tds)

    const mode = modeGrade()
    aggregate.value = {
      raw_samples: samples,
      metrics: repMetrics,
      grade: mode.grade,
      grade_index: mode.grade_index,
      grade_agreement: mode.agreement,
      stability: {
        total_readings: totalReadings.value,
        discarded: discarded.value,
        cv: lastCv.value,
      },
    }
    status.value = 'done'
  }

  // 状态机主循环：每来一个新聚合读数推进一步
  watch(batchedMetrics, async (m) => {
    if (status.value !== 'collecting' || !m) return

    // 全局守卫：未浸没(wet=false)帧为物理无效读数，既不计入检测次数也不进任何窗口
    if (m.wet === false) {
      discarded.value += 1
      return
    }

    totalReadings.value += 1

    // 阶段一：尚未稳定 → 用滑动窗口判稳，不收样本
    if (!stableReached.value) {
      // 窗口已满时先去离散：边界离散帧不得进入稳定窗口，否则会被阶段二继承并污染参考集
      if (window.value.length >= STABLE_WINDOW && isOutlier(m)) {
        discarded.value += 1
        return
      }
      window.value = [...window.value, m].slice(-STABLE_WINDOW)
      if (checkStable()) stableReached.value = true
    } else {
      // 阶段二：已稳定 → 先对照“干净参考窗口”去离散，再决定是否收样本
      // 关键：判定离散时参考集不包含当前帧本身，避免离散帧自我污染 μ/σ
      if (isOutlier(m)) {
        discarded.value += 1
        // 离散帧不进入参考窗口，防止污染后续帧的均值/标准差
      } else {
        const ev = await gradeSample(m)
        if (ev) {
          validSamples.value = [...validSamples.value, m]
          grades.value = [...grades.value, ev.grade_index]
          gradeLabels.value = [...gradeLabels.value, ev.grade]
          // 仅有效帧更新参考窗口
          window.value = [...window.value, m].slice(-STABLE_WINDOW)
        } else {
          discarded.value += 1 // 判级失败视为丢弃
        }
      }
    }

    // 收满 → 完成
    if (validSamples.value.length >= TARGET_SAMPLES) {
      finalize()
      return
    }
    // 超上限仍未收满 → 报错（水质持续不稳定）
    if (totalReadings.value >= MAX_READINGS) {
      errorMsg.value = '水质持续不稳定，未能在规定次数内收集到足够样本，请稳定水杯后重试。'
      status.value = 'error'
    }
  })

  return {
    status,
    errorMsg,
    // 进度
    collected,
    target,
    progress,
    stableReached,
    discarded,
    totalReadings,
    lastCv,
    // 结果
    aggregate,
    // 控制
    start,
    cancel,
  }
}
