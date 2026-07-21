# SDG6 AquaCheck · Part 2（水杯端 + 客户端）

三天 Hackathon 的 **水杯设计** 部分。三端结构：
水杯端(ESP32) --BLE--> 客户端(Nuxt3, 你负责) --HTTPS--> 后端(队友 Express+DB+LLM)

## 架构决策（Plan B：Nuxt3 + BFF）
- 客户端 = Nuxt3。`server/` 仅作 **薄 BFF 代理**：转发请求 + 注入 `X-API-Key`，把后端真实地址与 Key 藏在服务端，浏览器看不到。
- **不在 BFF 写 WQI / 大数据逻辑** —— 那是后端职责。
- **WQI 由后端算并同步返回**：客户端 `POST /api/readings` 只发 raw metrics，后端算完在响应里返回 `{ wqi, level }`，客户端直接展示。
- 客户端本地仅做 `localLevelFallback` 即时判级用于 UI 反馈，非权威。

## 关键约束
- **Web Bluetooth 仅 HTTPS 或 localhost 可用，且仅 Chrome / Edge 支持**。部署务必 HTTPS。
- **板子必须 ESP32**（Uno 无 BLE）。
- **BLE UUID 固定**：Service `0xFFE0` / Measurement `0xFFE1`（Notify）。firmware 与 `useBle.ts` 必须一致。
- **Demo Mode**：无硬件也能演示（`.env` 里 `NUXT_PUBLIC_DEMO_MODE=true` 或页面勾选）。

## 目录
```
sdg6-cup/
├── client/                     # Nuxt3 客户端（你负责）
│   ├── nuxt.config.ts          # runtimeConfig: 后端地址/Key(server) + demoMode(public)
│   ├── .env.example
│   ├── types/reading.ts        # 与 API 数据字典对齐的类型
│   ├── composables/
│   │   ├── useBle.ts           # Web Bluetooth 封装（连设备/订阅 0xFFE1/解析）
│   │   ├── useWqi.ts           # Demo 模拟 + 本地降级判级
│   │   └── useReadings.ts      # 调本地 BFF (/api/readings)
│   ├── components/MetricCard.vue
│   ├── pages/
│   │   ├── index.vue           # 检测页：连接→展示→上报→显示后端WQI
│   │   └── history.vue         # 历史记录
│   └── server/api/
│       ├── readings.post.ts    # BFF 代理：转发 + X-API-Key（同步返回 wqi/level）
│       └── readings.get.ts     # BFF 代理：查询历史
└── firmware/cup_ble/cup_ble.ino  # ESP32 BLE 骨架（UUID 对齐、JSON 载荷）
```

## 跑起来
```bash
cd client
cp .env.example .env      # 填后端地址/Key；无后端可先只用 Demo Mode
npm install
npm run dev               # http://localhost:3000 （localhost 满足 Web Bluetooth）
```

## 与队友的契约
以 `API_DESIGN.md` 为准。核心变更：`POST /readings` 请求体 **不含** `wqi/level`，后端计算后在响应 `data` 中同步返回 `{ id, wqi, level, server_received_at }`。

## 待办 / TODO
- [ ] firmware `readSensors()` 接真实传感器并标定换算
- [ ] 确认 measurement 载荷格式（当前 JSON 文本；若改二进制帧需同步改 `parseMeasurement`）
- [ ] 反地理编码填 `location.region`
- [ ] 后端联调后确认 BFF 透传的响应结构（`data` 包裹层）
