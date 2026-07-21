/**
 * BFF 代理：GET /api/reports  →  后端 GET {backend}/api/v1/reports
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const query = getQuery(event)

  try {
    const res = await $fetch(`${config.backendBaseUrl}/api/v1/reports`, {
      method: 'GET',
      headers: { 'X-API-Key': config.backendApiKey },
      query,
    })
    return (res as any)?.data ? { code: 0, message: 'ok', data: (res as any).data } : res
  } catch (e: any) {
    throw createError({
      statusCode: e?.response?.status || 502,
      statusMessage: 'Backend upstream error',
      data: e?.data,
    })
  }
})
