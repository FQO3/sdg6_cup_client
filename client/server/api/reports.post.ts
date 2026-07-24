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

    // Step 2: Forward to backend with legacy-compatible top-level fields.
    // 后端 /api/v1/reports 当前契约要求 raw_samples / grade / grade_index 在 body 顶层；
    // 客户端新采集契约则把 20 条原始样本与众数评级放在 capture 内。
    // 这里做 BFF 适配：既保留完整 capture 供后端存档，也把后端必填字段提升到顶层。
    const capture = body.capture ?? {}
    const rawSamples = body.raw_samples ?? capture.raw_samples
    if (!Array.isArray(rawSamples)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing raw_samples: expected body.raw_samples or body.capture.raw_samples',
      })
    }

    const forwardBody = {
      ...body,
      raw_samples: rawSamples,
      // 按新版“20 条评级取最多值”逻辑，优先使用 capture 内的众数评级；
      // pipeline 对代表读数的判级仅作为兼容旧 payload 的兜底。
      grade: capture.grade ?? grade,
      grade_index: capture.grade_index ?? grade_index,
    }

    // Step 3: Forward to backend
    const res = await $fetch(`${config.backendBaseUrl}/reports`, {
      method: 'POST',
      headers: {
        'X-API-Key': config.backendApiKey,
        'Content-Type': 'application/json',
      },
      body: forwardBody,
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
