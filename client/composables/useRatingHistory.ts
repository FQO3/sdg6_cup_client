import { ref } from 'vue'

/**
 * 跨页面共享的判级时间序列。
 * index.vue 中的 useEvaluate 往里 push，history.vue 读取渲染折线图。
 */

export interface RatingPoint {
  timestamp: number
  wqi: number
  level: string
}

export const ratingTimeline = ref<RatingPoint[]>([])

export function appendRatingPoint(p: RatingPoint) {
  ratingTimeline.value.push(p)
}

export function clearRatingTimeline() {
  ratingTimeline.value = []
}
