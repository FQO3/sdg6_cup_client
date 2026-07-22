// 与 API_DESIGN.md 附录数据字典保持一致
// ★ 两条链路拆分为独立类型
// ★ v2: 废弃 safe/warning/danger + WQI，全面接入 GB 3838-2002 六等级国标

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

/** GB 3838-2002 地表水环境质量标准等级 */
export type GBGrade = 'Ⅰ类' | 'Ⅱ类' | 'Ⅲ类' | 'Ⅳ类' | 'Ⅴ类' | '劣Ⅵ类'

/** 等级 → 序号（0=Ⅰ类 ... 5=劣Ⅵ类） */
export const GB_GRADE_ORDER: GBGrade[] = ['Ⅰ类', 'Ⅱ类', 'Ⅲ类', 'Ⅳ类', 'Ⅴ类', '劣Ⅵ类']

/** 等级 → 可读含义 */
export const GB_GRADE_LABELS: Record<GBGrade, string> = {
  'Ⅰ类': '源头水 / 国家自然保护区',
  'Ⅱ类': '集中式饮用水源地一级保护区',
  'Ⅲ类': '集中式饮用水源地二级保护区',
  'Ⅳ类': '一般工业用水区',
  'Ⅴ类': '农业用水区',
  '劣Ⅵ类': '严重污染水体',
}

/** 等级 → 大标题后缀的抽象吐槽（拼接在等级大文字后） */
export const GB_GRADE_TAGLINES: Record<GBGrade, string> = {
  'Ⅰ类': '矿泉感',
  'Ⅱ类': '能救',
  'Ⅲ类': '净化后能喝',
  'Ⅳ类': '别喝',
  'Ⅴ类': '喝了变异',
  '劣Ⅵ类': '纳尼???',
}

// ──────────────────────────────────────────
// 链路 A：实时判级（高频 / 不入库）
// ──────────────────────────────────────────

/** POST /evaluate 请求体：3 帧平均值+已过滤异常 */
export interface EvaluatePayload {
  device_id: string
  metrics: Metrics  // 3 帧平均值
}

/** POST /evaluate 响应：后端随机森林模型返回 GB 等级 */
export interface EvaluateResult {
  grade: GBGrade           // GB 3838-2002 等级
  grade_index: number      // 0-5
  confidence: number       // 最大类置信度 (0-1)
  probabilities: Partial<Record<GBGrade, number>>  // 各类概率
}

// ──────────────────────────────────────────
// 水体类型（提交报告时用户单选）
// 依据 GB 5749-2022 生活饮用水 + 常见 TDS 经验区间划分，仅作分类标注，不参与判级。
// ──────────────────────────────────────────

/** 用户可选的水体类型 */
export type WaterType =
  | 'tap'       // 自来水
  | 'river'     // 河水
  | 'lake'      // 湖水 / 池塘
  | 'well'      // 井水 / 地下水
  | 'purified'  // 纯净水 / 桶装水（RO）
  | 'mineral'   // 矿泉水
  | 'boiled'    // 煮沸水 / 开水
  | 'other'     // 其他

/** 水体类型枚举顺序（渲染单选框用） */
export const WATER_TYPE_ORDER: WaterType[] = [
  'tap', 'river', 'lake', 'well', 'purified', 'mineral', 'boiled', 'other',
]

/** 水体类型 → 中文标签 */
export const WATER_TYPE_LABELS: Record<WaterType, string> = {
  tap: '自来水',
  river: '河水',
  lake: '湖水 / 池塘',
  well: '井水 / 地下水',
  purified: '纯净水 / 桶装水',
  mineral: '矿泉水',
  boiled: '煮沸水 / 开水',
  other: '其他',
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

/**
 * 采集聚合结果（一次"开始记录"收满 20 条有效样本后的产物）
 *
 * ─ raw_samples：20 条原始传感器读数，逐条保留（已过稳定判定 + 去离散过滤）
 * ─ metrics：20 条原始样本的逐字段中位数，作为报告代表读数
 * ─ grade / grade_index：20 条各自 /evaluate 判级结果取「众数」（最多值）
 * ─ stability：稳定性诊断，供后端 / 大屏参考
 */
export interface CaptureAggregate {
  /** 20 条原始传感器读数逐条保留 */
  raw_samples: Metrics[]
  /** 代表读数：raw_samples 逐字段中位数 */
  metrics: Metrics
  /** 众数评级（20 条判级结果出现最多的等级） */
  grade: GBGrade
  grade_index: number
  /** 该众数等级在 20 条中的占比 (0-1)，反映一致性 */
  grade_agreement: number
  /** 采集稳定性诊断 */
  stability: {
    /** 达到目标所用的总检测次数（含被丢弃的离散/不稳定帧） */
    total_readings: number
    /** 被判为离散而丢弃的样本数 */
    discarded: number
    /** 各特征变异系数 σ/μ（越小越稳） */
    cv: Partial<Record<'ph' | 'temperature' | 'ec' | 'turbidity', number>>
  }
}

/** POST /reports 请求体 */
export interface ReportPayload {
  device_id: string
  location: ReportLocation
  /** 代表读数（= capture.metrics，逐字段中位数） */
  metrics: Metrics
  /** 用户选择的水体类型 */
  water_type: WaterType
  /** 用户确认上传的是真实水体数据（必须为 true 才允许提交） */
  authenticity_confirmed: boolean
  /** 20 条原始样本 + 众数评级 + 稳定性诊断 */
  capture: CaptureAggregate
  /** 用户备注（可选），如 "河水下游约 100m 处取样，有点异味" */
  user_note?: string
  measured_at: string  // ISO8601
}

/** POST /reports 响应 */
export interface ReportResult {
  report_id: string
  grade: GBGrade
  grade_index: number
  confidence: number
  /** LLM 水质分析报告 Markdown；hackathon 期间为占位文本 */
  llm_report: string
  created_at: string   // ISO8601 服务端入库时间
}

/** GET /reports 历史列表单项 */
export interface ReportRecord {
  report_id: string
  device_id: string
  grade: GBGrade
  grade_index: number
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
  grade: GBGrade
  grade_index: number
  confidence: number
  /**
   * 是否为"无数据"间隙标记。
   * true → 折线图该段断开/灰色，表示这段时间未连接水杯或未评测。
   */
  isGap?: boolean
}
