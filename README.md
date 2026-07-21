# SDG6 AquaCheck · Part 2（水杯端 + 客户端）

三天 Hackathon 的 **水杯设计** 部分。三端结构：
水杯端(ESP32) --BLE--> 客户端(Nuxt3, 你负责) --HTTPS--> 后端(队友 Express+DB+LLM)

## 架构决策（Nuxt3 + BFF + 两条独立链路）

客户端 = Nuxt3。`server/` 仅作 **薄 BFF 代理**：转发请求 + 注入 `X-API-Key`，把后端真实地址与 Key 藏在服务端，浏览器看不到。

**两条独立链路彻底拆分**：

| | 链路 A：实时判级 | 链路 B：提交报告 |
|---|---|---|
| **触发** | 自动（每 3 帧一次） | 用户主动点按钮 |
| **频率** | 高频 | 低频 |
| **是否入库** | ❌ 不入库 | ✅ 入库（reports 表） |
| **接口** | `POST /evaluate` | `POST /reports` |
| **返回** | `{wqi, level}` | `{report_id, wqi, level, llm_report, created_at}` |
| **用途** | 覆盖显示当前 WQI/等级 | 生成历史记录 + LLM 分析报告 |

- **客户端本地不判级**（Demo Mode 除外）。WQI/level 全部由后端数学模型计算。
- **不在 BFF 写 WQI / 大数据逻辑** —— 那是后端职责。
- **水位检测**：水杯端两根导线导通 = 高电平 → `wet: true`。客户端透传此标志提示浸没状态。
- **多帧聚合**：BLE 每收满 3 帧 → 逐字段取中位数（抗异常值）→ 调 `/evaluate`。同时保留最新单帧给 MetricCard 展示。

## 关键约束
- **Web Bluetooth 仅 HTTPS 或 localhost 可用，且仅 Chrome / Edge 支持**。部署务必 HTTPS。
- **板子必须 ESP32**（Uno 无 BLE）。
- **BLE UUID 固定**：Service `0xFFE0` / Measurement `0xFFE1`（Notify）。firmware 与 `useBle.ts` 必须一致。
- **Demo Mode**：无硬件也能演示（`.env` 里 `NUXT_PUBLIC_DEMO_MODE=true` 或页面勾选）。
- **不做本地缓存**：上报失败提示重试，不缓存到本地。

## 目录
```
sdg6-cup/
├── client/                          # Nuxt3 客户端（你负责）
│   ├── nuxt.config.ts               # runtimeConfig: 后端地址/Key(server) + demoMode(public)
│   ├── .env.example
│   ├── types/reading.ts             # 双链路类型：EvaluatePayload/Result + ReportPayload/Result + RatingPoint
│   ├── composables/
│   │   ├── useBle.ts                # Web Bluetooth + 3帧缓冲/中位数聚合 + wet 透传
│   │   ├── useWqi.ts                # Demo 模拟 + Demo 降级判级（仅 Demo 用）
│   │   ├── useEvaluate.ts           # 链路 A：监听 batchedMetrics → 调 /evaluate → 结果覆盖
│   │   ├── useReports.ts            # 链路 B：提交报告 / 查询历史
│   │   └── useRatingHistory.ts      # 跨页面共享的判级时间序列（供历史页折线图）
│   ├── components/MetricCard.vue    # 指标展示 + 每项静态阈值科普
│   ├── pages/
│   │   ├── index.vue                # 检测页：BLE 连接 → 实时判级区 + 提交报告区(含 note)
│   │   └── history.vue              # 历史：判级时间折线图（Canvas）+ 提交报告列表
│   └── server/api/
│       ├── evaluate.post.ts         # BFF：POST /api/evaluate → 后端 /api/v1/evaluate
│       ├── reports.post.ts          # BFF：POST /api/reports → 后端 /api/v1/reports
│       ├── reports.get.ts           # BFF：GET /api/reports → 后端 /api/v1/reports
│       └── reports/[id].get.ts      # BFF：GET /api/reports/:id → 后端 /api/v1/reports/{id}
└── firmware/cup_ble/cup_ble.ino     # ESP32 BLE 骨架（UUID 对齐、JSON 载荷含 wet 标志）
```

## 跑起来
```bash
cd client
cp .env.example .env      # 填后端地址/Key；无后端可先只用 Demo Mode
npm install
npm run dev               # 监听 0.0.0.0:3000（同网设备可访问；localhost 满足 Web Bluetooth）
```

## 部署（生产）
```bash
cd client
npm install
npm run build             # 产物在 .output/（Nitro node-server 预设）
npm run start             # 监听 0.0.0.0:3000（HOST/PORT 可用环境变量覆盖）
```
> 注意：Web Bluetooth 需 HTTPS，生产环境请在 0.0.0.0:3000 前置反向代理（Nginx/Caddy）启用 TLS。

## 与队友的契约
以 `API_DESIGN.md` 为准。核心接口：

| 接口 | 方向 | 说明 |
|------|------|------|
| `POST /api/v1/evaluate` | 客户端→后端 | 链路 A：发 3 帧平均值，后端数学模型返回 `{wqi, level}`，不入库 |
| `POST /api/v1/reports` | 客户端→后端 | 链路 B：提交报告（含 location、user_note），入库并返回 `{report_id, wqi, level, llm_report, created_at}` |
| `GET /api/v1/reports` | 客户端→后端 | 查询历史报告列表（分页/筛选） |
| `GET /api/v1/reports/{id}` | 客户端→后端 | 查询单条报告详情（含 llm_report 全文） |

客户端 BFF（`server/api/`）仅透传 + 注入 `X-API-Key`，不改请求/响应结构。

## 待办 / TODO

### 固件
- [ ] firmware `readSensors()` 接真实传感器并标定换算
- [ ] 确认 measurement 载荷格式（当前 JSON 文本；若改二进制帧需同步改 `parseMeasurement`）
- [ ] 水位检测器接线（两根导线导通→高电平，发送 `wet: true`）

### 客户端
- [ ] 反地理编码接入正式地图 API（当前用 Nominatim 免费服务，有频率限制）
- [ ] 后端联调后确认 BFF 透传的响应结构（`data` 包裹层）

### LLM 分析报告
- [ ] **hackathon 期间优先返回占位文本**（如 "报告生成中，敬请期待"）
- [ ] 后续迭代：后端 `POST /api/v1/reports` 异步调用 LLM，根据检测指标 + 区域水文数据生成水质分析报告（Markdown），写入 `llm_report` 字段
- [ ] 客户端 `GET /api/v1/reports/{id}` 展示 LLM 报告全文（history 页点击展开）
- [ ] 大屏端 `POST /api/v1/reports/generate` 生成政府/NGO 汇报材料（Part C）

### 传感器标定
- [ ] TDS：用标准液校准（如 342ppm / 1413μS/cm）
- [ ] pH：两点校准（pH 4.0 + 6.86 或 9.18）
- [ ] 浊度：福尔马肼标准液梯度校准
- [ ] 温度：出厂已校准，一般无需额外操作

## 数学模型模块
[跳转链接](/MathModeling-WaterQualification/Water%20Quality%20Pipeline/README.md)