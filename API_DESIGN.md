# SDG6 水质检测系统 · API 路由设计文档

> Part 2（水杯制作部分）三端通信契约。本文档定义 **水杯端 ↔ 客户端 ↔ 后端** 之间的全部接口。
> 面向 3 天 Hackathon：接口以「够用、能演示、能联调」为准，标注 `[MVP]` 为必做，`[待议]` 为加分项。

---

## 目录

- [0. 全局约定](#0-全局约定)
- [Part A：水杯端 ↔ 客户端（BLE GATT 协议）](#part-a水杯端--客户端ble-gatt-协议)
- [Part B：客户端 ↔ 后端（REST + WebSocket）](#part-b客户端--后端rest--websocket)
- [Part C：后端内部 / 大屏 / LLM API](#part-c后端内部--大屏--llm-api)
- [附录：统一数据字典](#附录统一数据字典)

---

## 0. 全局约定

### 0.1 通信矩阵

| 链路 | 协议 | 方向 | 说明 |
|------|------|------|------|
| 水杯端 → 客户端 | BLE GATT Notify | 单向推送 | ESP32 推原始/半成品数据 |
| 客户端 → 水杯端 | BLE GATT Write | 单向下发 | 校准/配置指令（可选） |
| 客户端 → 后端 | HTTPS REST | 请求/响应 | 上报数据、查询 |
| 后端 → 大屏 | WebSocket | 服务端推送 | 实时数据流 |
| 后端 内部 | HTTPS REST | 请求/响应 | 聚合、LLM 报告 |

### 0.2 通用规范

- **Base URL**：`https://api.<your-domain>.com`（联调期 `http://<ip>:8000`）
- **API 前缀**：所有 REST 接口以 `/api/v1` 开头
- **数据格式**：`application/json; charset=utf-8`
- **时间格式**：ISO 8601 UTC，如 `2025-01-15T08:30:00Z`
- **鉴权**：`[MVP]` 用简单 `X-API-Key` 头即可；`[待议]` JWT
- **单位约定**：TDS=ppm，pH=无量纲，温度=℃，浊度=NTU，余氯=mg/L

### 0.3 统一响应结构

```json
{
  "code": 0,
  "message": "ok",
  "data": { }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| code | int | 0=成功，非 0=错误（见下表） |
| message | string | 人类可读信息 |
| data | object/array/null | 业务数据 |

### 0.4 错误码

| code | HTTP | 含义 |
|------|------|------|
| 0 | 200 | 成功 |
| 1001 | 400 | 参数错误 |
| 1002 | 401 | 鉴权失败 |
| 1003 | 404 | 资源不存在 |
| 1004 | 422 | 数据校验失败（如指标越界） |
| 2001 | 500 | 服务器内部错误 |
| 3001 | 503 | LLM 服务不可用（触发兜底缓存） |

---

## Part A：水杯端 ↔ 客户端（BLE GATT 协议）

> BLE 不是 REST，"路由"体现为 **Service / Characteristic（UUID）**。客户端通过 Web Bluetooth API 订阅/读写。

### A.1 GATT 结构总览

| 层级 | 名称 | UUID（自定义示例） | 属性 | 说明 |
|------|------|-------------------|------|------|
| Service | Water Quality Service | `0000ffe0-...` | — | 主服务 |
| └ Char 1 `[MVP]` | Measurement | `0000ffe1-...` | Notify | 实时测量数据推送 |
| └ Char 2 | Device Info | `0000ffe2-...` | Read | 设备元信息 |
| └ Char 3 `[待议]` | Command | `0000ffe3-...` | Write | 下发校准/配置指令 |
| └ Char 4 `[待议]` | Battery | `0000ffe4-...` | Read/Notify | 电量 |

> 联调时可先用标准短 UUID（如 `0xFFE0/0xFFE1`）简化，正式用完整 128-bit UUID。

### A.2 Char 1 — Measurement（Notify）`[MVP]`

**方向**：ESP32 → 客户端（周期推送，建议 1~2s/次）

**Payload 方案（二选一）**

#### 方案 1：JSON（联调首选，可读性好）
```json
{ "tds": 342, "ph": 7.2, "temp": 25.3, "turb": 1.2, "seq": 105 }
```
> ⚠️ BLE 单包 MTU 默认约 20~23 字节，JSON 会超。需协商 MTU 到 ≥180，或改用方案 2。

#### 方案 2：二进制打包（省包，推荐正式用）
小端序，固定 16 字节：

| 偏移 | 字段 | 类型 | 说明 |
|------|------|------|------|
| 0 | seq | uint16 | 序号（丢包检测） |
| 2 | tds | uint16 | ppm |
| 4 | ph | int16 | pH×100（如 720=7.20） |
| 6 | temp | int16 | ℃×100 |
| 8 | turb | uint16 | NTU×100 |
| 10 | chlorine | uint16 | mg/L×100（无则 0） |
| 12 | flags | uint8 | bit0=校准中 bit1=低电 |
| 13 | reserved | uint8[3] | 预留对齐 |

**客户端处理**：解包 → 换算真实值 → 经 BFF 送随机森林模型判 GB 等级（见附录）。

### A.3 Char 2 — Device Info（Read）

**方向**：客户端读取一次
```json
{ "device_id": "cup-001", "fw": "1.0.0", "sensors": ["tds","ph","temp"] }
```

### A.4 Char 3 — Command（Write）`[待议]`

**方向**：客户端 → ESP32。1 字节指令码 + 可选参数：

| 指令码 | 名称 | 参数 | 说明 |
|--------|------|------|------|
| `0x01` | CALIBRATE_PH | 标准液值×100 (uint16) | 触发 pH 校准 |
| `0x02` | CALIBRATE_TDS | 标准液值 (uint16) | 触发 TDS 校准 |
| `0x03` | SET_INTERVAL | 秒 (uint8) | 设置上报周期 |
| `0x04` | RESET | — | 重启 |

### A.5 连接流程（客户端侧）

```
1. requestDevice({ filters:[{ services:[0xFFE0] }] })
2. gatt.connect()
3. getPrimaryService(0xFFE0)
4. getCharacteristic(0xFFE1) → startNotifications()
5. 监听 characteristicvaluechanged → 解包 → 建模 → 展示 → 上报后端
```

> **降级（Demo Mode）**：客户端提供开关，绕过 BLE，用内置模拟数据源产生同结构数据，保证无硬件也能演示全链路。

---

## Part B：客户端 ↔ 后端（REST + WebSocket）

> 客户端唯一与云通信的一端。负责实时判级、提交报告、查询历史。

> **★ 两条独立链路（务必区分）**
>
> | 链路 | 触发频率 | 是否入库 | 接口 | 用途 |
> |------|---------|---------|------|------|
> | **A 实时判级** | 高频（每 3 帧一次） | ❌ 不入库 | `POST /evaluate` | 覆盖显示当前 GB 等级，不留痕 |
> | **B 提交报告** | 低频（用户主动点按钮） | ✅ 入库 | `POST /reports` | 生成历史记录 + LLM 分析报告 |
>
> 客户端**本地不判级**（Demo Mode 除外）。链路 A 每收到 3 个 BLE 帧，取平均+过滤异常后调 `/evaluate`，后端随机森林模型返回 GB 3838-2002 等级（Ⅰ类~劣Ⅵ类）仅用于覆盖显示。链路 B 用户满意后点"提交报告"，才把稳定读数（含可选 `user_note`）入库并换回历史记录与 LLM 报告。

### B.1 路由总览

| 方法 | 路由 | 标记 | 入库 | 说明 |
|------|------|------|------|------|
| POST | `/api/v1/evaluate` | `[MVP]` | ❌ | **链路 A**：实时判级，发 3 帧平均值，返回 GB 六等级 |
| POST | `/api/v1/reports` | `[MVP]` | ✅ | **链路 B**：提交报告入库，返回 `{report_id, grade, grade_index, confidence, llm_report, created_at}` |
| GET | `/api/v1/reports` | `[MVP]` | — | 查询提交报告列表（分页/筛选） |
| GET | `/api/v1/reports/{id}` | | — | 查询单条报告详情（含 LLM 报告） |
| GET | `/api/v1/health` | `[MVP]` | — | 健康检查（联调必备） |
| POST | `/api/v1/devices/register` | `[待议]` | — | 设备/用户注册绑定 |

---

### B.2 `POST /api/v1/evaluate` — 实时判级 `[MVP]`（链路 A）

> **高频、不入库**。客户端每收到 3 个 BLE 帧 → 取平均值+过滤异常 → 调此接口 → 后端随机森林模型返回 `{grade, grade_index, confidence}`，客户端仅用于覆盖显示。

**Header**：`X-API-Key: <key>`

**Request Body**
```json
{
  "device_id": "cup-001",
  "metrics": { "temperature": 22.5, "ph": 7.2, "ec": 350, "turbidity": 15 }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_id | string | ✓ | 设备号 |
| metrics | object | ✓ | 3 帧的平均值（已过滤异常），key：temperature(℃)/ph(无量纲)/ec(μS/cm)/turbidity(NTU) |

> 请求体**极简**：不含 location、不含 user_note、不含 measured_at。这些字段留到链路 B。

**Response**
```json
{
  "code": 0, "message": "ok",
  "data": {
    "grade": "Ⅲ类",
    "grade_index": 2,
    "confidence": 0.8721,
    "probabilities": { "Ⅰ类": 0.0, "Ⅱ类": 0.0473, "Ⅲ类": 0.8721, "Ⅳ类": 0.0684, "Ⅴ类": 0.0122, "劣Ⅵ类": 0.0 }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| grade | string | GB 3838-2002 等级：Ⅰ类/Ⅱ类/Ⅲ类/Ⅳ类/Ⅴ类/劣Ⅵ类 |
| grade_index | number | 0-5 序号 |
| confidence | number | 随机森林最大类置信度 (0-1) |
| probabilities | object | 各类概率分布 |

> 后端收到后：**仅调模型判级 → 返回，不做任何持久化**。不对接大屏 WS、不写入数据库。

---

### B.3 `POST /api/v1/reports` — 提交报告 `[MVP]`（链路 B）

> **低频、用户主动、入库**。用户点"开始记录"→客户端进入**采集状态机**（见下），自动连续检测直至收满 **20 条有效样本**（去除不稳定/离散数据），采集完成后才提示：附加说明 + **真实性确认** + **水体类型单选**。确认后提交，后端入库并生成 LLM 分析报告。

**客户端采集状态机**（`useCapture`）：
> `idle → collecting → done / error`。`collecting` 阶段维护滑动窗口判稳（全特征 CV ≤ 阈值：ph/temperature 0.03、ec 0.08、turbidity 0.15），**稳定后**对每帧做离散判定（均值 ±2σ 之外则丢弃），有效帧调 `/api/evaluate` 判级并计入样本；收满 20 条 → `done`；累计检测超 60 次仍未收满 → `error`。
> - **原始数据逐条保留**：`capture.raw_samples` 为 20 条原始传感器读数（`Metrics[]`）。
> - **评级取众数**：`capture.grade / grade_index` 为 20 条判级结果的众数（并列取较差等级）。
> - `capture.metrics` 为 20 条读数逐字段中位数的**代表读数**（后端二次判级用）。

**Header**：`X-API-Key: <key>`

**Request Body**
```json
{
  "device_id": "cup-001",
  "location": { "lat": 30.5, "lng": 114.3, "region": "武汉市洪山区" },
  "metrics": { "tds": 342, "ph": 7.2, "temperature": 25.3, "turbidity": 1.2, "ec": 684 },
  "water_type": "river",
  "authenticity_confirmed": true,
  "capture": {
    "raw_samples": [
      { "ph": 7.2, "temperature": 25.3, "ec": 684, "turbidity": 1.2, "tds": 342, "wet": true }
    ],
    "metrics": { "ph": 7.2, "temperature": 25.3, "ec": 684, "turbidity": 1.2, "tds": 342 },
    "grade": "Ⅲ类",
    "grade_index": 2,
    "grade_agreement": 0.9,
    "stability": { "total_readings": 27, "discarded": 3, "cv": 0.021 }
  },
  "user_note": "河水下游约 100m 处取样，有点异味",
  "measured_at": "2025-01-15T08:30:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_id | string | ✓ | 设备号 |
| location.lat/lng | number | ✓ | 来自 Geolocation API |
| location.region | string | ✓ | 反地理编码结果（客户端调地图 API 获取） |
| metrics | object | ✓ | 代表读数（= `capture.metrics`，20 条逐字段中位数），后端二次判级用 |
| water_type | string | ✓ | 水体类型单选：`tap`(自来水)/`river`(河水)/`lake`(湖泊/水库)/`well`(井水/地下水)/`purified`(纯净水)/`mineral`(矿泉水)/`boiled`(煮沸后的水)/`other`(其他) |
| authenticity_confirmed | boolean | ✓ | 用户已勾选「真实采集的水体数据」；为 `false` 时客户端禁止提交 |
| capture | object | ✓ | 采集聚合结果，见下表 |
| user_note | string | | 用户备注（可选，留空也行） |
| measured_at | string | ✓ | ISO8601 测量时间 |

**capture 子字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| raw_samples | Metrics[] | **20 条原始传感器读数逐条保留** |
| metrics | object | 20 条读数逐字段中位数（代表读数） |
| grade / grade_index | string / number | 20 条判级结果**众数**（并列取较差等级） |
| grade_agreement | number | 众数占比（0-1），一致率 |
| stability | object | `{ total_readings, discarded, cv }`：累计检测次数、丢弃离散条数、最终稳定窗口 CV |

**Response**
```json
{
  "code": 0, "message": "ok",
  "data": {
    "report_id": "rpt-88231",
    "grade": "Ⅲ类",
    "grade_index": 2,
    "confidence": 0.8721,
    "llm_report": "TODO: LLM 分析报告（hackathon 期间优先做结构占位，内容后续补）",
    "created_at": "2025-01-15T08:31:05Z"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| report_id | string | 报告唯一 ID |
| grade | string | GB 3838-2002 等级 |
| grade_index | number | 0-5 序号 |
| confidence | number | 置信度 (0-1) |
| llm_report | string | LLM 生成的水质分析报告（Markdown）；**hackathon 期间优先返回占位文本**（如 "报告生成中，敬请期待"），后续迭代对接 LLM |
| created_at | string | ISO8601 服务端入库时间 |

> 后端收到后：调模型判级 → **入库**（reports 表）→ 返回含 `report_id` → 异步触发区域聚合更新并经 WS 推大屏 → **待做**：异步调用 LLM 生成 `llm_report` 字段内容。

---

### B.4 `GET /api/v1/reports` — 查询报告列表 `[MVP]`

**Query 参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| device_id | string | 按设备筛选 |
| region | string | 按区域筛选 |
| level | enum | 按等级筛选 |
| from / to | ISO8601 | 时间范围 |
| page / page_size | int | 分页，默认 1 / 20 |

**Response**
```json
{
  "code": 0, "message": "ok",
  "data": {
    "total": 134,
    "page": 1,
    "page_size": 20,
    "items": [
      {
        "report_id": "rpt-88231",
        "device_id": "cup-001",
        "grade": "Ⅲ类",
        "grade_index": 2,
        "location": { "lat": 30.5, "lng": 114.3, "region": "武汉市洪山区" },
        "user_note": "河水下游取样，有点异味",
        "measured_at": "2025-01-15T08:30:00Z",
        "created_at": "2025-01-15T08:31:05Z"
      }
    ]
  }
}
```

---

### B.5 `GET /api/v1/reports/{id}` — 查询单条报告详情

> 含 LLM 分析报告全文（`llm_report` 字段）。

**Response**
```json
{
  "code": 0, "message": "ok",
  "data": {
    "report_id": "rpt-88231",
    "device_id": "cup-001",
    "grade": "Ⅲ类",
    "grade_index": 2,
    "metrics": { "temperature": 22.5, "ph": 7.2, "ec": 350, "turbidity": 15 },
    "location": { "lat": 30.5, "lng": 114.3, "region": "武汉市洪山区" },
    "user_note": "河水下游取样，有点异味",
    "llm_report": "TODO: LLM 分析报告全文（Markdown）",
    "measured_at": "2025-01-15T08:30:00Z",
    "created_at": "2025-01-15T08:31:05Z"
  }
}
```

---

### B.6 `GET /api/v1/health` — 健康检查 `[MVP]`
```json
{ "code": 0, "message": "ok", "data": { "status": "up", "db": "ok", "time": "2025-01-15T08:30:00Z" } }
```

---

## Part C：后端内部 / 大屏 / LLM API

> 服务大屏可视化与 NGO 工作者。这部分是评委 eye-catching 的核心。

### C.1 路由总览

| 方法 | 路由 | 标记 | 说明 |
|------|------|------|------|
| GET | `/api/v1/stats/overview` | `[MVP]` | 大屏顶部核心指标卡 |
| GET | `/api/v1/stats/map` | `[MVP]` | 地图热力点数据 |
| GET | `/api/v1/stats/trend` | `[MVP]` | 区域水质时间趋势 |
| GET | `/api/v1/regions` | | 区域列表 + 概况 |
| GET | `/api/v1/regions/{id}` | | 单区域详情（含超标率/排名） |
| POST | `/api/v1/reports/generate` | `[待议]` | LLM 生成汇报/提案材料 |
| GET | `/api/v1/reports/{id}` | `[待议]` | 获取已生成报告 |
| WS | `/ws/live` | `[MVP]` | 实时数据流推大屏 |

---

### C.2 `GET /api/v1/stats/overview` — 核心指标卡 `[MVP]`
```json
{
  "code": 0, "message": "ok",
  "data": {
    "total_readings": 1342,
    "total_devices": 87,
    "total_regions": 12,
    "avg_grade_index": 1.8,
    "drinkable_rate": 0.63,
    "polluted_count": 45,
    "updated_at": "2025-01-15T08:30:00Z"
  }
}
```

### C.3 `GET /api/v1/stats/map` — 地图热力 `[MVP]`

**Query**：`grade_index`（可选，0-5）、`from`/`to`（可选）
```json
{
  "code": 0, "message": "ok",
  "data": {
    "points": [
      { "lat": 30.5, "lng": 114.3, "grade": "Ⅲ类", "grade_index": 2, "region": "武汉市洪山区", "count": 23 }
    ]
  }
}
```
> 前端用 ECharts/Leaflet 热力图渲染；`count` 用于聚合点权重。

### C.4 `GET /api/v1/stats/trend` — 时间趋势 `[MVP]`

**Query**：`region`（必填）、`metric`（默认 `grade_index`，可选真实特征 `ec`/`ph`/`turbidity`/`temperature`）、`interval`（`hour`/`day`）、`from`/`to`
```json
{
  "code": 0, "message": "ok",
  "data": {
    "region": "武汉市洪山区",
    "metric": "grade_index",
    "series": [
      { "t": "2025-01-14T00:00:00Z", "value": 1.6 },
      { "t": "2025-01-15T00:00:00Z", "value": 2.0 }
    ]
  }
}
```

### C.5 `GET /api/v1/regions/{id}` — 区域详情
```json
{
  "code": 0, "message": "ok",
  "data": {
    "region_id": "wh-hongshan",
    "name": "武汉市洪山区",
    "reading_count": 213,
    "avg_grade_index": 2.4,
    "grade_distribution": { "Ⅰ类": 12, "Ⅱ类": 40, "Ⅲ类": 88, "Ⅳ类": 50, "Ⅴ类": 18, "劣Ⅵ类": 5 },
    "rank": 4,
    "worst_metric": "ec"
  }
}
```

---

### C.6 `POST /api/v1/reports/generate` — LLM 生成汇报材料 `[待议]★`

**说明**：现场点击「一键生成报告」，把区域聚合数据喂给 LLM，输出结构化的政府/NGO 汇报文档。**演示很惊艳，但需兜底。**

**Request**
```json
{
  "region_id": "wh-hongshan",
  "report_type": "gov_proposal",
  "language": "zh"
}
```

| 字段 | 枚举 | 说明 |
|------|------|------|
| report_type | `gov_proposal` 政府改善提案 / `ngo_summary` NGO 汇报 / `public` 公众科普 | 报告类型 |
| language | `zh` / `en` | 语言 |

**Response**
```json
{
  "code": 0, "message": "ok",
  "data": {
    "report_id": "rp-001",
    "region_id": "wh-hongshan",
    "type": "gov_proposal",
    "title": "武汉市洪山区水质改善建议报告",
    "content_md": "## 一、现状分析\n本区域近30天...",
    "generated_at": "2025-01-15T08:30:00Z",
    "source": "llm"
  }
}
```

> **兜底策略**：LLM 超时/失败（code 3001）时，返回预生成的缓存报告，`source: "cache"`，保证 demo 不断链。
> **防幻觉**：Prompt 中只注入真实聚合数字（来自 C.5），要求 LLM 基于给定数据撰写，不臆造。

---

### C.7 `WS /ws/live` — 实时数据流 `[MVP]`

**用途**：新检测记录入库后，后端主动推给大屏，实现"数据实时滚动流入"效果。

**连接**：`wss://api.<domain>/ws/live`

**服务端推送消息（新检测事件）**
```json
{
  "type": "new_reading",
  "data": {
    "id": "r-88231",
    "region": "武汉市洪山区",
    "grade": "Ⅲ类",
    "grade_index": 2,
    "location": { "lat": 30.5, "lng": 114.3 },
    "measured_at": "2025-01-15T08:30:00Z"
  }
}
```

**消息类型**

| type | 说明 |
|------|------|
| `new_reading` | 新检测记录 |
| `stats_update` | 概览指标变化（可选，节流推送） |
| `alert` | 出现 Ⅴ类/劣Ⅵ类 等级的告警（大屏红色闪烁）`[待议]` |

---

## 附录：统一数据字典

### 水质等级（GB 3838-2002 地表水环境质量标准，随机森林四参数模型）

**模型输入参数**（四个低成本传感器可测指标）：

| 参数 | 字段 | 单位 | 说明 |
|------|------|------|------|
| 水温 | temperature | ℃ | 水体温度 |
| pH | ph | 无量纲 | 酸碱度，7 为中性 |
| 电导率 | ec | μS/cm | 溶解性离子总量 |
| 浊度 | turbidity | NTU | 水体浑浊程度 |

**模型输出等级**（6 级，准确率 74.1%，±1 级容错率 97.3%）：

| 序号 | 等级 | 含义 | 水体功能 |
|------|------|------|---------|
| 0 | Ⅰ类 | 优质 | 源头水、国家自然保护区 |
| 1 | Ⅱ类 | 良好 | 集中式饮用水源地一级保护区 |
| 2 | Ⅲ类 | 一般 | 集中式饮用水源地二级保护区 |
| 3 | Ⅳ类 | 较差 | 一般工业用水区 |
| 4 | Ⅴ类 | 差 | 农业用水区 |
| 5 | 劣Ⅵ类 | 严重污染 | 污染水体，不适宜任何用途 |

> 模型：Random Forest (scikit-learn, n=400, balanced)，互信息最大特征为电导率 (0.475 bits)，Fano 理论天花板 78.8%。

### ★ Water Quality Pipeline 真实契约（FastAPI，端口 8080）

> 以 `api.py` 的 Pydantic 模型为**唯一事实来源**。BFF（`server/api/evaluate.post.ts`、`reports.post.ts`）直连此服务。
> ⚠️ README 里的 curl 示例用中文 key，**已过时**；真实字段是英文小写。

**启动**：`python -m uvicorn api:app --app-dir "./Water Quality Pipeline" --host 0.0.0.0 --port 8080`（Swagger：`:8080/docs`）

#### `POST /predict` — 判级（客户端不直接调，经 BFF 转发）

**Request（PredictRequest）**
```json
{ "temperature": 22.5, "ph": 7.2, "ec": 350, "turbidity": 15, "wet": false }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| temperature | float | ✓ | 水温 ℃ |
| ph | float | ✓ | 酸碱度 |
| ec | float | ✓ | 电导率 μS/cm |
| turbidity | float | ✓ | 浊度 NTU |
| wet | bool | | 水位导通标志，默认 `false`。**接收但模型当前不使用**（仅 4 特征参与预测） |

> 模型仅用 `[temperature, ph, ec, turbidity]` 四特征。Pydantic 会忽略多余字段，故 BFF 透传含 `tds` 的 `metrics` 无害。

**Response（PredictResponse）**
```json
{
  "grade": "Ⅱ类",
  "grade_index": 1,
  "confidence": 0.8721,
  "probabilities": { "Ⅰ类": 0.0, "Ⅱ类": 0.8721, "Ⅲ类": 0.0684, "Ⅳ类": 0.0473, "Ⅴ类": 0.0122, "劣Ⅵ类": 0.0 }
}
```
> 注意：Pipeline 直接返回**裸对象**（无 `{code,message,data}` 包裹）。BFF 负责包裹成统一响应结构。

#### `GET /health`
```json
{ "status": "ok", "model": "4feat" }
```

#### `GET /info`
返回等级顺序、特征清单、互信息(bits)、测试指标。**注意返回体为中文 key**（诊断用途，客户端不消费）。

**等级顺序**：`["Ⅰ类","Ⅱ类","Ⅲ类","Ⅳ类","Ⅴ类","劣Ⅵ类"]`
**指标**：Acc 74.1% ·±1 级容错 97.3% · QWK 0.869 · MAE 0.316 · Fano 天花板 78.8%

### 其他传感器指标（供 MetricCard 展示参考，不参与模型判级）

| 指标 | 字段 | 单位 | 参考范围 |
|------|------|------|---------|
| 总溶解固体 | tds | ppm | <300 低矿化度 / 300-600 中等 / >600 高矿化度 |

### 等级枚举（TypeScript 客户端类型）
```ts
type GBGrade = 'Ⅰ类' | 'Ⅱ类' | 'Ⅲ类' | 'Ⅳ类' | 'Ⅴ类' | '劣Ⅵ类'
```
客户端展示时可用 6 色渐变：
- Ⅰ类 `#1565c0`（深蓝，源头水）
- Ⅱ类 `#42a5f5`（亮蓝，饮用水一级）
- Ⅲ类 `#66bb6a`（绿色，饮用水二级）
- Ⅳ类 `#ffb300`（琥珀，工业用水）
- Ⅴ类 `#ef6c00`（橙色，农业用水）
- 劣Ⅵ类 `#c62828`（红色，污染）

---

## 联调优先级速查

| 阶段 | 必通接口 |
|------|---------|
| Day 1 | BLE `A.2` 或 Demo Mode → `POST /evaluate`（链路 A） → `GET /health` |
| Day 2 | `POST /reports`（链路 B）、`GET /reports`（历史列表）、`stats/overview`、`stats/map`、`WS /ws/live` |
| Day 3 | `stats/trend`、`GET /reports/{id}`（LLM 报告详情）、`reports/generate`（大屏 LLM 汇报） |

**契约冻结原则**：Day 1 结束前三端确认字段名与数据结构，之后不轻易改动，避免联调返工。
