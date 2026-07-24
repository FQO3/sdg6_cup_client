[![OctoCounts](https://api.octocounts.com/badge/FQO3/sdg6_cup_client/branch/main)](https://octocounts.com/github/FQO3/sdg6_cup_client/tree/main)
![OctoCounts2](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAACWAAAATsCAYAAAAE6LkNAAAQAElEQVR4Aey8CYPkSJacZwZxd6Zn9qBE8SYlUv//Ly6gz567IxyIuzLryhkkntuzd7sDEV3TU9nLv/vjH7Z/+Ms/7vLv/vIx/g9Trej/7lTvH07+f3jqv8x2nft339/P5Ce+A3990vvsf5WPuK+M2Vsk3wfBIR/lo87fcfuHv5/B3/QZ/OOT5/+P/8T31xTzabzX3eu9yUfeL43s6TDfq3zEDeT8q87gf8ct5zHkH+6cx9n/q/Axx8Ax/+Dv4Z8OZ3Gd+67/HP+78j73P3fs78g/7rzbv5WPvK+M//yP235e2eerfMT9Hdv5/bLnwGdgfq5Xc5afPfT3oGJj+9159jDLeT+zL/ozf2K+k/zLqe6rfMR9ZczeInkvg0Pe4H9Kzjk+ti7l7/o/gr8KH3MMzGyRwf+OfG6m5/UVzyN7itx77vFFhj965C3+r/0cwT91+ceOxf/9n7YDx3fgZ///+eftT8T86d93hFd8OLF/gv9pR2Ju8mG/gf8XttQKJvej+B+olzq3kNp//g9/bH8C/9Rx8Nv4x9bsHcn58/+dfHjwzLGVf9hPPL5Iegdvyn9stf8cvCl/2Y6+wZ/gf4ofmTH6R+U/95q3MLZX5DDDX7c/F+/4nx9gfCf540U+4v74L9Qn5ybiK/uLmNjIn3t89D/+6z9txcEr/l//usX/x138p+7/hfC/9VluYWz/7Z+3P74Zk3uS/975wP8x8djCg0Oe8L+c/Dvv9r/8T+qnVsfBC4l5jv+y/VFxL+L/0+MK/2X7S+E/F/7lf3be8R4f9qdI7dTf427x/5ee6ReMf8bokeGP/rb86/aXQ87gL+L/6nG38H8x+2yPXtLtpZP/Iv5BvT+I/eMm/st22/6vj+3/++Qf/EX8yxz3v5nhxMs/7OCvwsccA//I3NN8w/4lkPflsI97fNjfwf+vvT9/6e9l9Un+hdf797af55)
# SDG6 AquaCheck · Part 2（水杯端 + 客户端）

三天 Hackathon 的 **水杯设计** 部分。四层架构：
**水杯端**(ESP32) --BLE--> **客户端**(Nuxt3) --HTTPS--> **Pipeline**(FastAPI, RF 模型) --HTTPS--> **后端**(队友 Express+DB+LLM)

## 架构决策

### Nuxt3 + BFF 薄代理
客户端 = Nuxt3。`server/` 仅作 **薄 BFF 代理**：转发请求 + 注入 `X-API-Key`，把后端真实地址与 Key 藏在服务端，浏览器看不到。

### Water Quality Pipeline（随机森林 GB 等级预测）
队友独立开发的 FastAPI 服务（端口 8080），基于 scikit-learn Random Forest (n=400) 对 **4 参数**（temperature, ph, ec, turbidity）进行 GB 3838-2002 国标 6 级分类：

| 序号 | 等级 | 含义 |
|------|------|------|
| 0 | Ⅰ类 | 源头水 / 国家自然保护区 |
| 1 | Ⅱ类 | 集中式饮用水源地一级保护区 |
| 2 | Ⅲ类 | 集中式饮用水源地二级保护区 |
| 3 | Ⅳ类 | 一般工业用水区 |
| 4 | Ⅴ类 | 农业用水区 |
| 5 | 劣Ⅵ类 | 污染水体 |

模型准确率 74.1%，±1 级容错率 97.3%。具体见 `API_DESIGN.md` 附录。

### 两条独立链路彻底拆分（v2：GB 国标版）

| | 链路 A：实时判级 | 链路 B：提交报告 |
|---|---|---|
| **触发** | 自动（每 3 帧一次） | 用户主动点按钮 |
| **频率** | 高频 | 低频 |
| **是否入库** | ❌ 不入库 | ✅ 入库（reports 表） |
| **数据流** | 客户端 → BFF → Pipeline `/predict` | 客户端 → BFF→Pipeline(判级)→后端 `/reports`(入库) |
| **接口** | `POST /api/evaluate` | `POST /api/reports` |
| **返回** | `{grade, grade_index, confidence}` | `{report_id, grade, grade_index, llm_report, created_at}` |
| **用途** | 覆盖显示当前 GB 等级 | 生成历史记录 + LLM 分析报告 |

- **客户端本地不判级**（Demo Mode 除外）。GB 等级全部由 Pipeline 随机森林模型计算。
- **不在 BFF 写判级 / 大数据逻辑** —— 那是 Pipeline 和后端的职责。
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
│   ├── nuxt.config.ts               # runtimeConfig: backendBaseUrl/pipelineBaseUrl(server) + demoMode(public)
│   ├── .env.example
│   ├── types/reading.ts             # GB 6 级类型：GBGrade, EvaluateResult, ReportResult, RatingPoint
│   ├── composables/
│   │   ├── useBle.ts                # Web Bluetooth + 3帧缓冲/中位数聚合 + wet 透传
│   │   ├── useWqi.ts                # Demo 模拟 + Demo 降级判级（仅 Demo 用）
│   │   ├── useEvaluate.ts           # 链路 A：监听 batchedMetrics → BFF → Pipeline /predict → grade
│   │   ├── useReports.ts            # 链路 B：提交报告 / 查询历史
│   │   └── useRatingHistory.ts      # 跨页面共享的判级时间序列（grade_index, 供历史页折线图）
│   ├── components/MetricCard.vue    # 指标展示：标注模型输入参数 + TDS 补充参考
│   ├── pages/
│   │   ├── index.vue                # 检测页：BLE 连接 → GB 等级显示(6色) + 提交报告区
│   │   └── history.vue              # 历史：判级折线图(grade_index) + 报告列表(按 GB 等级着色)
│   └── server/api/
│       ├── evaluate.post.ts         # BFF：直接调 Pipeline /predict（不回后端）
│       ├── reports.post.ts          # BFF：先调 Pipeline 判级 → 合并 grade 后转发后端 /reports
│       ├── reports.get.ts           # BFF：GET /api/reports → 后端 /api/v1/reports
│       └── reports/[id].get.ts      # BFF：GET /api/reports/:id → 后端 /api/v1/reports/{id}
└── firmware/cup_ble/cup_ble.ino     # ESP32 BLE 骨架（UUID 对齐、JSON 载荷含 wet 标志）
```

## 跑起来
```bash
# 1. 启动 Pipeline（队友）
cd MathModeling-WaterQualification/"Water Quality Pipeline"
python api.py                         # FastAPI 监听 localhost:8080

# 2. 启动后端（队友）
# Express 监听 localhost:4000

# 3. 启动客户端
cd client
cp .env.example .env                  # 填 pipelineBaseUrl + backendBaseUrl
npm install
npm run dev                           # 监听 0.0.0.0:3000
```

## 与队友的契约
以 `API_DESIGN.md` 为准。核心接口：

| 接口 | 调用链 | 说明 |
|------|--------|------|
| `POST {pipeline}/predict` | BFF → Pipeline | 支持 4 特征（temp/ph/ec/turb），返回 `{grade, grade_index}` |
| `POST /api/evaluate` | 客户端 → BFF → Pipeline | 链路 A：发 3 帧平均值 → Pipeline 判级，不入库 |
| `POST /api/reports` | 客户端 → BFF→Pipeline→后端 | 链路 B：先判级再入库，返回 `{report_id, grade, grade_index, llm_report}` |
| `GET /api/reports` | 客户端 → BFF → 后端 | 查询历史报告列表（分页） |
| `GET /api/reports/{id}` | 客户端 → BFF → 后端 | 查询单条报告详情（含 llm_report 全文） |

客户端 BFF（`server/api/`）**evaluate 链路直连 Pipeline**（不经过业务后端），**reports 链路先调 Pipeline 判级再转发后端入库**。

## 待办 / TODO

### 固件
- [ ] firmware `readSensors()` 接真实传感器（temperature, ph, ec, turbidity）并标定换算
- [ ] 确认 measurement 载荷格式（当前 JSON 文本；若改二进制帧需同步改 `parseMeasurement`）
- [ ] 水位检测器接线（两根导线导通→高电平，发送 `wet: true`）

### 客户端
- [ ] 反地理编码接入正式地图 API（当前用 Nominatim 免费服务，有频率限制）
- [ ] Pipeline 联调确认 `/predict` 输入字段名和返回值结构
- [ ] 后端联调确认 `reports.post.ts` BFF 合并 grade 后的入库逻辑

### Pipeline 模型
- [ ] 确认 `/predict` 端点支持单条和批量两种模式
- [ ] 特征顺序对齐：`[temperature, ph, ec, turbidity]`
- [ ] 返回格式对齐：`{grade: "Ⅲ类", grade_index: 2}`

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
[跳转链接](/WaterQuality/Water%20Quality%20Pipeline/README.md)

## LLM水质描述服务
[跳转链接](/Services/LLM/README.md)

## LSTM/LLM水质预测描述服务
[跳转链接](/Services/LSTM/README.md)