/**
 * BFF 代理：GET /api/reports/:id  →  后端 GET {backend}/api/v1/reports/{id}
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const id = getRouterParam(event, 'id')

  try {
    const res = await $fetch(`${config.backendBaseUrl}/api/v1/reports/${id}`, {
      method: 'GET',
      headers: { 'X-API-Key': config.backendApiKey },
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
