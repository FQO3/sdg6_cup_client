/**
 * BFF: POST /api/evaluate → Water Quality Pipeline POST {pipeline}/predict
 * 链路 A：实时 GB 等级预测，不入库。直连流水线（绕过业务后端）。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  // body: { device_id, metrics: { temperature, ph, ec, turbidity } }

  try {
    const pipelineResult = await $fetch(`${config.pipelineBaseUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body.metrics ?? body,
    })
    // pipelineResult: { grade: string, grade_index: number }
    console.log('[evaluate] Pipeline response:', JSON.stringify(pipelineResult))
    const r = pipelineResult as any
    return {
      code: 0,
      message: 'ok',
      data: {
        grade: r.grade,
        grade_index: r.grade_index,
        confidence: r.confidence,
        probabilities: r.probabilities,
      },
    }
  } catch (e: any) {
    console.error('[evaluate] Pipeline error:', e?.data ?? e?.message)
    throw createError({
      statusCode: e?.response?.status || 502,
      statusMessage: 'Pipeline upstream error',
      data: e?.data,
    })
  }
})
