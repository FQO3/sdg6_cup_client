// 与 API_DESIGN.md 附录数据字典保持一致
// ★ 两条链路拆分为独立类型

/** 水杯端 BLE 解析出的原始水质指标（换算为真实值） */
export interface Metrics {
  tds?: number          // ppm
  ph?: number           // 0-14
  temperature?: number  // ℃
  turbidity?: number    // NTU
  ec?: number           // μS/cm
  /** 水位检测：两根导线导通=高电平 → true（水杯浸没在水中） */
  wet?: boolean
  [k: string]: number | boolean | undefined
}

export type WaterLevel = 'safe' | 'warning' | 'danger'

// ──────────────────────────────────────────
// 链路 A：实时判级（高频 / 不入库）
// ──────────────────────────────────────────

/** POST /evaluate 请求体：3 帧平均值+已过滤异常 */
export interface EvaluatePayload {
  device_id: string
  metrics: Metrics  // 3 帧平均值
}

/** POST /evaluate 响应：后端数学模型返回 */
export interface EvaluateResult {
  wqi: number          // 0-100
  level: WaterLevel
}

// ──────────────────────────────────────────
// 链路 B：提交报告（低频 / 用户主动 / 入库）
// ──────────────────────────────────────────

/** 地理位置（提交报告时必填 region） */
export interface ReportLocation {
  lat: number
  lng: number
  /** 反地理编码结果，如 "武汉市洪山区"，由客户端地图 API 获取 */
  region: string
}

/** POST /reports 请求体 */
export interface ReportPayload {
  device_id: string
  location: ReportLocation
  metrics: Metrics
  /** 用户备注（可选），如 "河水下游约 100m 处取样，有点异味" */
  user_note?: string
  measured_at: string  // ISO8601
}

/** POST /reports 响应 */
export interface ReportResult {
  report_id: string
  wqi: number
  level: WaterLevel
  /** LLM 水质分析报告 Markdown；hackathon 期间为占位文本 */
  llm_report: string
  created_at: string   // ISO8601 服务端入库时间
}

/** GET /reports 历史列表单项 */
export interface ReportRecord {
  report_id: string
  device_id: string
  wqi: number
  level: WaterLevel
  metrics: Metrics
  location: ReportLocation
  user_note?: string
  llm_report?: string
  measured_at: string
  created_at: string
}

// ──────────────────────────────────────────
// 判级时间序列（链路 A 结果按时间记录，供历史页折线图）
// ──────────────────────────────────────────

/** 单个判级时间序列点 */
export interface RatingPoint {
  /** Unix 毫秒时间戳：本次判级发生时刻 */
  timestamp: number
  wqi: number
  level: WaterLevel
  /**
   * 是否为"无数据"间隙标记。
   * true → 折线图该段断开/灰色，表示这段时间未连接水杯或未评测。
   */
  isGap?: boolean
}
