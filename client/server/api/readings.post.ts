/**
 * BFF 代理：POST /api/readings  →  后端 POST {backend}/readings
 * 职责仅限：转发请求体 + 注入 X-API-Key + 透传后端同步返回的 {wqi, level}
 * 不在此处写 WQI 计算 / 大数据逻辑（那是队友后端的事）。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)

  try {
    const res = await $fetch(`${config.backendBaseUrl}/readings`, {
      method: 'POST',
      headers: { 'X-API-Key': config.backendApiKey },
      body,
    })
    // 后端约定返回 { code, message, data:{ id, wqi, level, server_received_at } }
    return (res as any)?.data ?? res
  } catch (e: any) {
    throw createError({
      statusCode: e?.response?.status || 502,
      statusMessage: 'Backend upstream error',
      data: e?.data,
    })
  }
})
