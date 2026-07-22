/**
 * BFF 代理：GET /api/geocode?lat=..&lng=..
 * → 高德逆地理编码 REST API（restapi.amap.com/v3/geocode/regeo）
 * 返回 { formatted_address } —— 即当前所处地点的格式化地址。
 * Key 仅存于服务端，不下发浏览器。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { lat, lng } = getQuery(event)

  const latN = Number(lat)
  const lngN = Number(lng)
  if (!latN || !lngN) {
    return { formatted_address: '未知区域' }
  }

  try {
    const res = await $fetch<{
      status: string
      regeocode?: { formatted_address?: string | string[] }
    }>('https://restapi.amap.com/v3/geocode/regeo', {
      method: 'GET',
      query: {
        // 高德坐标顺序为 "经度,纬度"
        location: `${lngN},${latN}`,
        key: config.amapKey,
        radius: 1000,
        extensions: 'base',
      },
    })

    const raw = res?.regeocode?.formatted_address
    const address = Array.isArray(raw) ? raw.join('') : raw
    return { formatted_address: address || '未知区域' }
  } catch {
    return { formatted_address: '未知区域' }
  }
})
