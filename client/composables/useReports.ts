import type { ReportPayload, ReportResult, ReportRecord } from '~/types/reading'

/**
 * 链路 B — 提交报告
 *
 * ─ 用户点"提交报告"时调用 submit()，入库 + 返回 report_id + LLM 报告
 * ─ list() 查询历史报告列表
 */

export function useReports() {
  /** 提交报告（入库） */
  async function submit(payload: ReportPayload): Promise<ReportResult> {
    const res = await $fetch<{ code: number; data: ReportResult }>('/api/reports', {
      method: 'POST',
      body: payload as unknown as Record<string, unknown>,
    })
    return res.data
  }

  /** 查询历史报告列表 */
  async function list(params?: Record<string, string | number>): Promise<ReportRecord[]> {
    const res = await $fetch<{ code: number; data: { items: ReportRecord[] } }>('/api/reports', {
      params,
    })
    return res.data?.items ?? []
  }

  /** 查询单条报告详情（含 llm_report） */
  async function detail(reportId: string): Promise<ReportRecord> {
    const res = await $fetch<{ code: number; data: ReportRecord }>(`/api/reports/${reportId}`)
    return res.data
  }

  return { submit, list, detail }
}
