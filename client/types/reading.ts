// 与 API_DESIGN.md 附录数据字典保持一致

/** 水杯端 BLE 解析出的原始水质指标（换算为真实值） */
export interface Metrics {
  tds?: number        // ppm
  ph?: number         // 0-14
  temperature?: number // ℃
  turbidity?: number  // NTU
  ec?: number         // μS/cm
  [k: string]: number | undefined
}

/** 客户端上报后端的请求体（注意：不含 wqi/level，由后端计算） */
export interface ReadingPayload {
  device_id: string
  user_id?: string
  location: { lat: number; lng: number; region?: string }
  metrics: Metrics
  measured_at: string // ISO8601
}

export type WaterLevel = 'safe' | 'warning' | 'danger'

/** POST /readings 同步响应中后端算出的评估结果 */
export interface ReadingResult {
  id: string
  wqi: number          // 0-100，后端数学模型
  level: WaterLevel
  server_received_at: string
}

/** GET /readings 历史条目 */
export interface ReadingRecord extends ReadingPayload {
  id: string
  wqi: number
  level: WaterLevel
}
