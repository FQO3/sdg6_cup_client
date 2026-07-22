/**
 * BFF: POST /api/reports → 1) Pipeline /predict 判级 → 2) Backend /api/v1/reports 入库
 * 链路 B：提交报告入库。BFF 先调流水线取 GB 等级，再合并进 body 转发到业务后端。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  // body: {
  //   device_id, location: { lat, lng, region },
  //   metrics: { temperature, ph, ec, turbidity, tds? },  // 采集代表读数（逐字段中位数）
  //   water_type,                    // 用户单选的水体类型（tap/river/lake/...）
  //   authenticity_confirmed,        // 用户已勾选「真实水体数据」
  //   capture: { raw_samples[], metrics, grade, grade_index, grade_agreement, stability },
  //   user_note?, measured_at?,
  // }

  try {
    // Step 1: Call pipeline to get GB grade（模型只用 4 特征，显式取字段避免多余键）
    const metrics = body.metrics
    if (!metrics) {
      throw createError({ statusCode: 400, statusMessage: 'Missing metrics in report body' })
    }
    const pipelineResult = await $fetch(`${config.pipelineBaseUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        temperature: metrics.temperature,
        ph: metrics.ph,
        ec: metrics.ec,
        turbidity: metrics.turbidity,
        wet: metrics.wet ?? false,
      },
    })
    const { grade, grade_index } = pipelineResult as any

    // Step 2: Forward to backend with grade added
    const res = await $fetch(`${config.backendBaseUrl}/reports`, {
      method: 'POST',
      headers: {
        'X-API-Key': config.backendApiKey,
        'Content-Type': 'application/json',
      },
      body: { ...body, grade, grade_index },
    })

    return (res as any)?.data
      ? { code: 0, message: 'ok', data: (res as any).data }
      : res
  } catch (e: any) {
    console.error('[reports] Upstream error:', e?.data ?? e?.message)
    if (e?.statusCode) throw e // re-throw H3 errors
    throw createError({
      statusCode: e?.response?.status || 502,
      statusMessage: 'Upstream error',
      data: e?.data,
    })
  }
})
