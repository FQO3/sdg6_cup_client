import type { ReadingPayload, ReadingResult, ReadingRecord } from '~/types/reading'

/** 客户端只调用本地 BFF（/api/*），Key 由 server 侧注入，浏览器看不到 */
export function useReadings() {
  /** 上报一条检测，同步拿回后端算的 wqi/level */
  async function submit(payload: ReadingPayload): Promise<ReadingResult> {
    return await $fetch<ReadingResult>('/api/readings', {
      method: 'POST',
      body: payload,
    })
  }

  /** 查询历史 */
  async function list(params?: Record<string, string | number>): Promise<ReadingRecord[]> {
    return await $fetch<ReadingRecord[]>('/api/readings', { params })
  }

  return { submit, list }
}
