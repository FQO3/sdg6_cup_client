import type { RatingPoint } from '~/types/reading'
import { ref } from '#imports'

/**
 * 跨页面共享的判级时间序列。
 * index.vue 中的 useEvaluate 往里 push，history.vue 读取渲染折线图 / 报告列表。
 */
export const ratingTimeline = ref<RatingPoint[]>([])

export function appendRatingPoint(p: RatingPoint) {
  ratingTimeline.value.push(p)
}

/** 追加间隙标记（断开连接/无数据时段） */
export function appendGapPoint(timestamp: number) {
  ratingTimeline.value.push({
    timestamp,
    grade: 'Ⅴ类',
    grade_index: -1,
    confidence: 0,
    isGap: true,
  })
}

export function clearRatingTimeline() {
  ratingTimeline.value = []
}
