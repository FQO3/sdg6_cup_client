/**
 * BFF 代理：POST /api/evaluate  →  后端 POST {backend}/evaluate
 * 链路 A：实时判级，不入库。职责仅限：转发 + 注入 X-API-Key。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)

  try {
    const res = await $fetch(`${config.backendBaseUrl}/api/v1/evaluate`, {
      method: 'POST',
      headers: { 'X-API-Key': config.backendApiKey },
      body,
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
