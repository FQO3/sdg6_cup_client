/**
 * BFF 代理：GET /api/readings  →  后端 GET {backend}/readings
 * 透传查询参数，注入 X-API-Key。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const query = getQuery(event)

  try {
    const res = await $fetch(`${config.backendBaseUrl}/readings`, {
      method: 'GET',
      headers: { 'X-API-Key': config.backendApiKey },
      query,
    })
    return (res as any)?.data ?? res
  } catch (e: any) {
    throw createError({
      statusCode: e?.response?.status || 502,
      statusMessage: 'Backend upstream error',
      data: e?.data,
    })
  }
})
