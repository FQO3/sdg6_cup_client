/**
 * BFF 代理：POST /api/reports  →  后端 POST {backend}/api/v1/reports
 * 链路 B：提交报告入库。职责：转发 + 注入 X-API-Key。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)

  try {
    const res = await $fetch(`${config.backendBaseUrl}/api/v1/reports`, {
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
